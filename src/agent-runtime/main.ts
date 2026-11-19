/**
 * The Agent Runtime: one long-lived process per Claude Agent, started by k-bench inside a
 * hidden tmux session (ADR-0007) and built into one self-contained file with the Agent SDK
 * inside (`vite.runtime.config.ts`). It holds the conversation (ADR-0008): it writes every
 * SDK message to the Agent's log, and sends the log and everything live to every client
 * connected to its unix socket. docs/internals/agent.md is the tour.
 *
 * It and its Claude Code live and die together. Whichever ends first, the runtime records
 * why (`exit.json`, and a `stopped` entry in the log) and exits; nothing restarts it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeExitRecord } from "../agent/exit.ts";
import { AgentLog } from "../agent/log.ts";
import { agentLogFile, agentSocketFile, runtimeBuildId } from "../agent/paths.ts";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentClientMessage,
  type AgentHello,
  openPermissionAsks,
} from "../shared/agent-protocol.ts";
import { parseRuntimeArgs } from "./args.ts";
import { PermissionAsks } from "./asks.ts";
import { ClientHub } from "./hub.ts";
import { LiveText } from "./live.ts";
import { ClaudeSession } from "./session.ts";

/** Put in at build time from the SDK's package.json (`vite.runtime.config.ts`). */
declare const __SDK_VERSION__: string;
declare const __SDK_CLAUDE_CODE_VERSION__: string;

const args = parseRuntimeArgs(process.argv.slice(2));
// The build ID is the hash of this very file, which a file cannot hold itself.
const buildId = runtimeBuildId(readFileSync(fileURLToPath(import.meta.url)));
const log = new AgentLog(agentLogFile(args.agentDir));

let claudeVersion = "unknown";
let finishing = false;
/** Prompts sent whose turn has not ended yet. */
let pendingTurns = 0;

const hello = (): AgentHello => ({
  type: "hello",
  protocol: AGENT_PROTOCOL_VERSION,
  runtimeBuildId: buildId,
  claudeVersion,
  sdkVersion: __SDK_VERSION__,
  sdkClaudeCodeVersion: __SDK_CLAUDE_CODE_VERSION__,
});

const live = new LiveText();

const hub = new ClientHub({
  socketFile: agentSocketFile(args.agentDir),
  log,
  hello,
  snapshot: () => live.snapshot(),
  onCommand: (message) => void command(message),
});

/** Appends to the log and tells every synced client, in that order. */
function record(entry: Parameters<AgentLog["append"]>[0]): void {
  hub.entry(log.append(entry));
}

function publishStatus(): void {
  hub.setStatus({ type: "status", state: pendingTurns > 0 ? "working" : "idle" });
}

record({ kind: "runtime", event: "started" });

// Asks a previous runtime left open (it was killed, or the Host went down) can never be
// answered: the Claude Code that asked them is gone. Close them, so that no device shows a
// card nobody can answer.
for (const ask of openPermissionAsks(log.readAfter(0))) {
  record({
    kind: "permission_answered",
    requestId: ask.requestId,
    answer: { decision: "interrupted" },
  });
}

const asks = new PermissionAsks(record);

// A conversation is saved by Claude Code only after its first message, so a resume of one
// that never got a prompt starts it again under the same ID instead.
const claude = new ClaudeSession(
  {
    claude: args.claude,
    folder: args.folder,
    conversation: {
      id: args.conversation,
      resume: args.mode === "resume" && log.hasPrompt(),
    },
    canUseTool: asks.canUseTool,
  },
  {
    message(message) {
      if (message.type === "stream_event") {
        // Fragments go live and are never logged; the text so far is kept for late joiners.
        const fragment = message as unknown as Record<string, unknown>;
        live.fragment(fragment);
        hub.partial(fragment);
        return;
      }
      record({ kind: "sdk", message: message as unknown as Record<string, unknown> });
      if (message.type === "result") {
        live.turnEnded();
        pendingTurns = Math.max(0, pendingTurns - 1);
        publishStatus();
      }
    },
    ended(error) {
      const why = error instanceof Error ? error.message : "Claude Code exited";
      void finish(why.slice(0, 1000), 1);
    },
  },
);

async function command(message: AgentClientMessage): Promise<void> {
  if (message.type === "prompt") {
    record({ kind: "prompt", id: message.id, text: message.text });
    pendingTurns += 1;
    publishStatus();
    claude.prompt(message.id, message.text);
  } else if (message.type === "interrupt") {
    claude.interrupt();
  } else if (message.type === "answer") {
    asks.answer(message.requestId, message.decision);
  } else if (message.type === "shutdown") {
    await finish("Stopped by k-bench", 0);
  }
}

/** Records why the runtime ends, ends Claude Code and exits. Only the first call counts. */
async function finish(reason: string, code: number): Promise<void> {
  if (finishing) return;
  finishing = true;
  try {
    asks.interruptAll();
    record({ kind: "runtime", event: "stopped", reason });
  } catch {
    // The Agent's folder is gone (the Session was deleted): nothing to record into.
  }
  try {
    writeExitRecord(args.agentDir, { reason });
  } catch {
    // Same.
  }
  claude.close();
  await hub.close();
  process.exit(code);
}

for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
  process.on(signal, () => void finish("Stopped by a signal", 0));
}
process.on("uncaughtException", (error) => {
  void finish(`The Agent Runtime failed: ${error.message}`, 1);
});
process.on("unhandledRejection", (error) => {
  void finish(
    `The Agent Runtime failed: ${error instanceof Error ? error.message : String(error)}`,
    1,
  );
});

// Listen only once `claude` has said what version it is, so that every hello carries it.
// If it dies first, `ended` above has already recorded why.
try {
  claudeVersion = await claude.claudeVersion();
  await hub.listen();
} catch (error) {
  await finish(error instanceof Error ? error.message.slice(0, 1000) : String(error), 1);
}
