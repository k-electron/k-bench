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
  type AgentContextUsage,
  type AgentHello,
  openPermissionAsks,
  type PermissionMode,
} from "../shared/agent-protocol.ts";
import { Activity } from "./activity.ts";
import { parseRuntimeArgs } from "./args.ts";
import { PermissionAsks } from "./asks.ts";
import { AgentBell } from "./bell.ts";
import { CommandList, terminalOnlyFrom } from "./commands.ts";
import { ClientHub } from "./hub.ts";
import { promptContent } from "./images.ts";
import { LiveText } from "./live.ts";
import { PermissionModeTracker } from "./mode.ts";
import { ClaudeSession } from "./session.ts";
import { TaskTracker } from "./tasks.ts";

/** Put in at build time from the SDK's package.json (`vite.runtime.config.ts`). */
declare const __SDK_VERSION__: string;
declare const __SDK_CLAUDE_CODE_VERSION__: string;

const args = parseRuntimeArgs(process.argv.slice(2));
// The build ID is the hash of this very file, which a file cannot hold itself.
const buildId = runtimeBuildId(readFileSync(fileURLToPath(import.meta.url)));
const log = new AgentLog(agentLogFile(args.agentDir));

let claudeVersion = "unknown";
let finishing = false;
/** How full Claude Code's context was when last asked (at the start and after each turn). */
let context: AgentContextUsage | undefined;

const hello = (): AgentHello => ({
  type: "hello",
  protocol: AGENT_PROTOCOL_VERSION,
  runtimeBuildId: buildId,
  claudeVersion,
  sdkVersion: __SDK_VERSION__,
  sdkClaudeCodeVersion: __SDK_CLAUDE_CODE_VERSION__,
  folder: args.folder,
});

const live = new LiveText();

const hub = new ClientHub({
  socketFile: agentSocketFile(args.agentDir),
  log,
  hello,
  snapshot: () => live.snapshot(),
  onCommand: (message) => void command(message),
  onViewed: () => bell.viewed(),
});

// The Agent's Bell: raised by a turn ending or an ask opening while nobody views the Agent.
const bell = new AgentBell({
  viewers: () => hub.viewers,
  changed: () => publishStatus(),
});

// Idle, Working or Waiting for you: Waiting is an open ask (`asks`, below).
const activity = new Activity({
  openAsks: () => asks.count,
  publish: () => publishStatus(),
});

/** Appends to the log and tells every synced client, in that order. */
function record(entry: Parameters<AgentLog["append"]>[0]): void {
  hub.entry(log.append(entry));
  // An ask opening or closing is what turns Working into Waiting for you and back.
  if (entry.kind === "permission_asked" || entry.kind === "permission_answered") {
    // Before the state changes, so that whoever sees Waiting for you sees the Bell with it.
    if (entry.kind === "permission_asked") bell.attention();
    activity.asksChanged();
  }
}

const permissionMode = new PermissionModeTracker();

const asks = new PermissionAsks(record, (toolUseId) =>
  permissionMode.planApproved(toolUseId),
);

// The `/` menu. Which commands are terminal-only is known only from a turn's `init`, so an
// Agent that has had a turn starts from what its log says (CommandList).
const commandList = new CommandList(
  terminalOnlyFrom(
    log.readAfter(0).flatMap((entry) => (entry.kind === "sdk" ? [entry.message] : [])),
  ),
);

// The subagents and background tasks running now (#149): they outlive turns.
const tasks = new TaskTracker();

/** Sends every connection the status: what the Agent is doing, its mode, tasks and Bell. */
function publishStatus(): void {
  const running = tasks.list;
  hub.setStatus({
    ...activity.status,
    ...(running.length > 0 && { tasks: running }),
    ...(permissionMode.current && { mode: permissionMode.current }),
    ...(bell.isRaised && { bell: true }),
    ...(context && { context }),
  });
}

/**
 * Asks Claude Code how full its context is and publishes it. Claude Code does not push this
 * (the terminal reads the same). It may not be able to answer (an older one, or one that is
 * going), which only means there is nothing to show: never let that reach the runtime's own
 * handlers, which would end the Agent.
 */
async function refreshContext(): Promise<void> {
  if (finishing) return;
  try {
    const usage = await claude.contextUsage();
    if (finishing) return;
    context = usage;
    publishStatus();
  } catch {
    // Nothing to show.
  }
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
    launch: args.launch,
  },
  {
    message(message) {
      // Any turn's `result` (done, failed or interrupted, sent by the owner or by nobody),
      // before the state goes Idle so that whoever sees Idle sees the Bell with it.
      if (message.type === "result") bell.attention();
      // Before the state is read, so that a status sent for the turn's end has its tasks.
      const tasksChanged = tasks.observe(message);
      activity.message(message);
      if (message.type === "stream_event") {
        // Fragments go live and are never logged; the text so far is kept for late joiners.
        const fragment = message as unknown as Record<string, unknown>;
        live.fragment(fragment);
        hub.partial(fragment);
        return;
      }
      record({ kind: "sdk", message: message as unknown as Record<string, unknown> });
      // Either may change the status; once, not twice, when both do.
      const modeChanged = permissionMode.observe(message);
      if (tasksChanged || modeChanged) publishStatus();
      const afterPlan = permissionMode.afterPlan(message);
      if (afterPlan) void leavePlanMode(afterPlan);
      if (commandList.observe(message as unknown as Record<string, unknown>)) {
        hub.setCommands(commandList.commands);
      }
      if (message.type === "result") {
        live.turnEnded();
        void refreshContext();
      }
    },
    elicitationDeclined(request) {
      record({ kind: "declined", what: "elicitation", request: { ...request } });
    },
    ended(error) {
      const why = error instanceof Error ? error.message : "Claude Code exited";
      void finish(why.slice(0, 1000), 1);
    },
  },
);

/**
 * Claude Code has run an approved ExitPlanMode and the runtime still shows plan mode: set the
 * mode plan approval returns to, so that Claude Code's mode and the mode line agree. If Claude
 * Code refuses, nothing changes.
 */
async function leavePlanMode(mode: PermissionMode): Promise<void> {
  try {
    await claude.setPermissionMode(mode);
    if (permissionMode.set(mode)) publishStatus();
  } catch {
    // Claude Code refused: the line keeps showing what was last known.
  }
}

async function command(message: AgentClientMessage): Promise<void> {
  if (message.type === "prompt") {
    // Built before anything is logged or counted: nothing that goes wrong with an image may
    // leave a prompt logged that Claude never got.
    const content = promptContent(args.agentDir, message.text, message.images);
    record({
      kind: "prompt",
      id: message.id,
      text: message.text,
      ...(message.images && { images: message.images }),
    });
    activity.prompt();
    claude.prompt(message.id, content);
  } else if (message.type === "interrupt") {
    claude.interrupt();
  } else if (message.type === "stop_task") {
    claude.stopTask(message.taskId);
  } else if (message.type === "answer") {
    asks.answer(message.requestId, message);
  } else if (message.type === "set_permission_mode") {
    try {
      await claude.setPermissionMode(message.mode);
      if (permissionMode.set(message.mode)) publishStatus();
    } catch {
      // Claude Code refused (the owner's settings can forbid a mode): nothing changes, and
      // every Pane keeps showing the mode that is in force.
    }
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
  permissionMode.set(await claude.permissionMode());
  commandList.set(await claude.commands());
  hub.setCommands(commandList.commands);
  publishStatus();
  await hub.listen();
  void refreshContext();
} catch (error) {
  await finish(error instanceof Error ? error.message.slice(0, 1000) : String(error), 1);
}
