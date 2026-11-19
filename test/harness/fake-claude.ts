import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { PermissionMode } from "../../src/shared/agent-protocol.ts";
import { pollUntil } from "./poll.ts";
import type { TerminalClient } from "./terminal.ts";

const STUB = join(import.meta.dirname, "fake-claude.sh");
const SDK_FAKE = join(import.meta.dirname, "fake-claude-sdk.mjs");
const SESSION_FILES = join(import.meta.dirname, "fake-claude-session.mjs");
const FIXTURES = join(import.meta.dirname, "fixtures");

/**
 * Claude Code's folder for one test instance: where both fakes save the conversations as Claude
 * Code does, and what the instance's config names as `claudeConfigDir`, so that the Agent
 * Runtime's import reads it and never the owner's own.
 */
export function fakeClaudeConfigDir(program: string): string {
  return join(dirname(program), "claude-config");
}

/**
 * Puts the fake Claude Code (`fake-claude.sh`) in a folder of `root` and returns its path,
 * for the instance config's Claude Code program. The conversations it saves live beside it,
 * so each test instance has its own. So does what the fake for the Agent SDK needs: its
 * script `fake-claude-sdk.mjs`, the messages recorded from a real Claude Code, and a link to
 * the `node` that runs it (a test's tmux Session does not have the test's PATH).
 */
export function installFakeClaude(root: string): string {
  // Hidden, so it does not show up when a test lists the folders of the instance's root.
  const folder = join(root, ".fake-claude");
  mkdirSync(folder, { recursive: true });
  const program = join(folder, "claude");
  copyFileSync(STUB, program);
  chmodSync(program, 0o755);
  copyFileSync(SDK_FAKE, join(folder, "fake-claude-sdk.mjs"));
  copyFileSync(SESSION_FILES, join(folder, "fake-claude-session.mjs"));
  cpSync(FIXTURES, join(folder, "fixtures"), { recursive: true });
  symlinkSync(process.execPath, join(folder, "node"));
  return program;
}

/**
 * A subagent or background task the fake starts (#149), as Claude Code reports one
 * (`task_started`, and `background_tasks_changed` for a background one). Shapes come from the
 * SDK's types: they were not recorded from a real Claude Code.
 */
export interface FakeTask {
  /** The task's ID: what `stop_task` and `FakeClaude.endTask` name. */
  id: string;
  description?: string;
  /** A subagent (default) or a background shell command. */
  type?: "agent" | "bash";
  subagentType?: string;
  /** Goes on after the turn ends, and is listed in `background_tasks_changed`. Otherwise it blocks its tool call. */
  background?: boolean;
}

/** One thing a scripted turn does, in order. See `FakeClaude.script`. */
export type FakeStep =
  /** Streams a text block: a sentence (sent word by word) or its fragments, which may include `{ hold }`. */
  | { text: string | Array<string | { hold: string }> }
  /** Streams a thinking block (its text is not sent, as Claude Code's is not). */
  | { thinking: true }
  /**
   * A tool call. With `ask`, Claude Code asks the SDK's `canUseTool` first and waits for the
   * answer; the tool then "runs" and returns `result`, or, if denied, the denial's message as
   * an error. `ask` may set `suggestions` (permission updates), `description` and `extra`
   * (more fields of the request, such as `blocked_path`).
   */
  | {
      tool: { name: string; input?: Record<string, unknown>; id?: string };
      ask?: true | { suggestions?: unknown[]; description?: string; extra?: object };
      /** The tool keeps running until the test calls `release(name)`; an interrupt ends the turn with it unanswered. */
      hold?: string;
      /**
       * The tool is a subagent (`Agent`) or a background command (`Bash`): its task starts with
       * the tool call, sharing its `tool_use_id`. A foreground task ends before the tool's
       * result; a `background` one goes on (the result then only says it started).
       */
      task?: FakeTask;
      result?: string;
      isError?: boolean;
      toolUseResult?: unknown;
    }
  /** Waits until the test calls `release(name)`, or the turn is interrupted. */
  | { hold: string }
  /** Starts a task that has no tool call of its own (a standalone line in the Transcript). */
  | { task: FakeTask }
  /** Progress of a running task, as `task_progress` reports it. */
  | {
      taskProgress: {
        id: string;
        toolUses?: number;
        tokens?: number;
        durationMs?: number;
        lastTool?: string;
        summary?: string;
      };
    }
  /** Ends a running task from inside the turn. */
  | { taskEnd: { id: string; status?: "completed" | "failed" | "stopped" } }
  /** Claude Code changes its own permission mode (as leaving plan mode does) and says so. */
  | { mode: PermissionMode }
  /** Sends this message as it is: a type the browser does not know, for instance. */
  | { raw: Record<string, unknown> }
  /** Sends a `system` message of this subtype (`api_retry`, `compact_boundary`, ...). */
  | { system: { subtype: string } & Record<string, unknown> }
  /**
   * An MCP server asks the owner for input (an elicitation): Claude Code sends the request and
   * the turn waits for the SDK's answer, which `received()` then holds as a `control_response`.
   */
  | { elicit: { serverName?: string; message?: string; requestedSchema?: object } }
  /** `/clear`: the conversation resets and the next `init` carries a new session id. */
  | { reset: true }
  /** Changes fields of the turn's final `result` message (`is_error`, `subtype`, ...). */
  | { result: Record<string, unknown> }
  /** Crashes: writes `stderr` and exits with this code. */
  | { exit: number; stderr?: string };

/** What the fake is, as `initialize` and each turn's `system/init` report it. */
export interface FakeClaudeConfig {
  account?: Record<string, unknown>;
  /** The `claude_code_version` it reports. */
  version?: string;
  plugins?: Array<{ name: string; path: string; version?: string; source?: string }>;
  commands?: Array<{
    name: string;
    description?: string;
    argumentHint?: string;
    builtin?: boolean;
  }>;
  terminalSlashCommands?: string[];
  model?: string;
  /** The answer to `get_context_usage`; null is a Claude Code too old to know the request. */
  contextUsage?: Record<string, unknown> | null;
  /** More fields for every `system/init`. */
  initFields?: Record<string, unknown>;
  /** Whether it sends `system/session_state_changed` (default true); false, as a Claude Code that does not. */
  sessionStateMessages?: boolean;
  /** How long it takes to notice it is being closed, before it records that and exits. */
  closeDelayMs?: number;
  /**
   * The test's stand-in for the owner's Claude Code user settings file: a prompt `/advisor
   * <model>` writes `{advisorModel}` to it, as the real command saves the owner's default.
   */
  userSettingsFile?: string;
}

/** What the fake wrote to `received.jsonl`: `kind` says which. */
export type FakeReceived =
  | {
      kind: "start";
      pid: number;
      cwd: string;
      argv: string[];
      env: Record<string, string | undefined>;
    }
  | {
      kind: "control_request";
      message: {
        request_id: string;
        request: { subtype: string } & Record<string, unknown>;
      };
    }
  | { kind: "control_response"; message: { response: Record<string, unknown> } }
  | { kind: "prompt"; message: { uuid?: string; message: { content: unknown } } }
  | { kind: "interrupted"; busy: boolean }
  | { kind: "closed" }
  | { kind: "terminated" }
  | { kind: "other" | "unreadable"; message?: unknown; line?: string };

/**
 * The test's hand on the fake Claude Code that the Agent SDK drives
 * (`fake-claude-sdk.mjs`): it decides what the fake is and what its next turns do, and reads
 * what the fake received. Everything goes through files beside the fake, which runs as a
 * process of its own (in a tmux Session, once the server starts Agents). With no script a
 * turn answers `fake claude heard: <prompt>`.
 */
export class FakeClaude {
  private readonly folder: string;
  private written = 0;

  constructor(root: string) {
    this.folder = join(root, ".fake-claude");
  }

  /** Changes what the fake reports. Settings not mentioned keep their value. */
  configure(changes: FakeClaudeConfig): void {
    const file = join(this.folder, "config.json");
    const current = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as FakeClaudeConfig)
      : {};
    this.write(file, { ...current, ...changes });
  }

  /**
   * Scripts a turn: each prompt takes the oldest scripted turn not yet taken. A `/clear`
   * takes none (Claude Code handles it itself, with no turn) and resets the conversation.
   * Script before sending the prompt.
   */
  script(steps: FakeStep[]): void {
    this.writeTurn({ steps });
  }

  /** Scripts a turn nobody sent, as `/loop` causes: it starts by itself once the fake is idle. */
  spontaneous(steps: FakeStep[]): void {
    this.writeTurn({ steps, auto: true });
  }

  /** Lets a turn waiting at `{ hold: name }` carry on. */
  release(name: string): void {
    this.write(join(this.folder, "script", `release-${name}`), {});
  }

  /**
   * Ends a running task from outside any turn, as a background task finishes by itself: the
   * fake says so as `task_updated`, `task_notification` and a new `background_tasks_changed`.
   * Does nothing if no such task is running.
   */
  endTask(id: string, status: "completed" | "failed" = "completed"): void {
    this.write(join(this.folder, "tasks", `end-${id}.json`), { id, status });
  }

  /**
   * Sends this message as it is, outside any turn: what a background task's own messages
   * look like when they arrive after the turn that started it has ended.
   */
  say(message: Record<string, unknown>): void {
    this.written += 1;
    const name = `say-${Date.now()}-${String(this.written).padStart(6, "0")}.json`;
    this.write(join(this.folder, "tasks", name), message);
  }

  /** Everything the fake has received, in order (several runs of it add to the same list). */
  received(): FakeReceived[] {
    const file = join(this.folder, "received.jsonl");
    if (!existsSync(file)) return [];
    const entries: FakeReceived[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      try {
        entries.push(JSON.parse(line) as FakeReceived);
      } catch {
        // The empty line at the end, or one half written: it is read again next time.
      }
    }
    return entries;
  }

  /** The prompts the SDK sent, in order. */
  prompts(): Array<{ uuid?: string; content: unknown }> {
    return this.received().flatMap((entry) =>
      entry.kind === "prompt"
        ? [{ uuid: entry.message.uuid, content: entry.message.message.content }]
        : [],
    );
  }

  /** Waits for a received entry the check accepts, and returns it. */
  waitForReceived<T extends FakeReceived>(
    check: (entry: FakeReceived) => entry is T,
    description: string,
  ): Promise<T> {
    return pollUntil(() => this.received().find(check) as T | undefined, { description });
  }

  private writeTurn(turn: { steps: FakeStep[]; auto?: boolean }): void {
    this.written += 1;
    const name = `${Date.now()}-${String(this.written).padStart(6, "0")}.json`;
    this.write(join(this.folder, "script", name), turn);
  }

  /** Writes through a temporary name, so the fake never reads half a file. */
  private write(file: string, value: unknown): void {
    mkdirSync(join(file, ".."), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(value));
    renameSync(temporary, file);
  }
}

/**
 * The arguments the fake Claude Code printed, in order, once it has started. A restart may
 * try twice (resume, then a fresh start), and the screen shows both: this is the attempt
 * that started, the last one.
 */
export async function fakeClaudeArgs(terminal: TerminalClient): Promise<string[]> {
  await terminal.waitForOutput("claude-stub ready");
  const starts = terminal.output.split("claude-stub cwd:");
  const last = starts[starts.length - 1] ?? "";
  return [...last.matchAll(/claude-stub arg: ([^\r\n]+)/g)].map(
    (match) => match[1] as string,
  );
}
