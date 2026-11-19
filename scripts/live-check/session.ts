// One Agent SDK session the live check drives, with the rails built in: Haiku and low effort on
// every query, the advisor off, tools decided by `decideTool`, the turn budget counted from
// `result`, the model asserted from the first `init`, and the `claude` process in a group of
// its own so that none can outlive the run. Its options come from k-bench's own
// `sdkLaunchOptions` and mirror `ClaudeSession` (src/agent-runtime/session.ts), so that what
// is checked is what ships.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Readable, Transform, Writable } from "node:stream";
import {
  type AgentDefinition,
  type CanUseTool,
  type PermissionMode,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { LaunchOptions } from "../../src/shared/launch-options.ts";
import type { FakeClaude } from "../../test/harness/fake-claude.ts";
import { type Places, recordableLine } from "./privacy.ts";
import {
  type Budget,
  BudgetExhausted,
  blockedTools,
  claudeEnvironment,
  decideTool,
  modelProblem,
  type SettingsRisk,
  type ToolPolicy,
} from "./rails.ts";
import type { SettingsChange, SettingsWatch } from "./settings-watch.ts";
import { sdkLaunchOptions } from "./shipped.ts";
import { processesIn } from "./sweep.ts";

export type Msg = Record<string, unknown>;

/** What one run of the script is: where it works, what it may spend, what it started. */
export interface Run {
  id: string;
  fake: boolean;
  startedAt: number;
  /** Where the redacted recordings and results.md go. */
  out: string;
  /** The run's temp folder. */
  tmp: string;
  /** The throwaway folder (a real path) inside it. */
  folder: string;
  /** Claude Code's folder (`~/.claude`, or a temp one in `--fake`). */
  configDir: string;
  /** The `claude` to run (the installed one; the fake in `--fake`). */
  claude: string;
  places: Places;
  budget: Budget;
  /** Watches the owner's settings files, per scenario. */
  settingsWatch: SettingsWatch;
  /** Changes it found, with the scenario each happened in. */
  settingsChanges: SettingsChange[];
  /** What the owner's settings allow (see `settingsRisk`). */
  settings: SettingsRisk;
  /** Aborts the whole run: set when a rail is broken. */
  abort: AbortController;
  /** Why it was aborted. */
  abortReason?: string;
  sessions: Set<LiveSession>;
  /** The process IDs of every `claude` the run started, and the group each leads. */
  pids: Set<number>;
  /** The conversation IDs the run saw. */
  sessionIds: Set<string>;
  /** The plan files `ExitPlanMode` named. */
  reportedPlans: string[];
  /** In `--fake`: the hand on the fake Claude. */
  fakeClaude?: FakeClaude;
  say(line: string): void;
  /** Ends the whole run with this reason (a rail was broken). */
  fail(reason: string): void;
  /** Ends the whole run because its turn budget is spent: what finished before is still good. */
  stopForBudget(reason: string): void;
  /** What ended the run early, if anything. */
  abortKind?: "rail" | "budget";
}

export class RunAborted extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

export interface SessionSpec {
  /** The scenario: names the budget scope and the recording. */
  name: string;
  /** Launch options besides the model and effort, which are always Haiku and low. */
  launch?: Partial<Pick<LaunchOptions, "advisor" | "focusView">>;
  policy?: Omit<ToolPolicy, "folder">;
  blocked?: Parameters<typeof blockedTools>[0];
  permissionMode?: PermissionMode;
  /** Whether `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` is set; by default, whenever the advisor launch option is off. */
  advisorOff?: boolean;
  /** Carry on this conversation. */
  resume?: string;
  /** Per-turn limits of the SDK, besides the run's budget. */
  maxTurns?: number;
  agents?: Record<string, AgentDefinition>;
  /** Called for every permission ask before it is answered. */
  onAsk?: (toolName: string, input: Record<string, unknown>) => void;
  /** Extra `settings` for this session only (flag-tier, never the owner's files). */
  extraSettings?: Record<string, unknown>;
}

/** One permission ask Claude Code made and how it was answered. */
export interface Ask {
  toolName: string;
  input: Record<string, unknown>;
  decision: "allow" | "deny";
}

type Wire = { dir: "in" | "out"; message: Msg };

class Input implements AsyncIterable<SDKUserMessage> {
  private waiting: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(message: SDKUserMessage): void {
    this.waiting.push(message);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.waiting.length > 0) yield this.waiting.shift() as SDKUserMessage;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

function lines(sink: (line: string) => void): (chunk: Buffer) => void {
  let held = "";
  return (chunk) => {
    held += chunk.toString("utf8");
    for (let at = held.indexOf("\n"); at >= 0; at = held.indexOf("\n")) {
      const line = held.slice(0, at);
      held = held.slice(at + 1);
      if (line.trim() !== "") sink(line);
    }
  };
}

/** Kills a `claude` and everything it started (it leads a group of its own). */
export function killGroup(
  pid: number | undefined,
  signal: NodeJS.Signals = "SIGKILL",
): void {
  if (pid === undefined) return;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
    } catch {
      // Already gone.
    }
  }
}

export class LiveSession {
  readonly msgs: Msg[] = [];
  /** Prompts and messages in the order the runtime would have logged them. */
  readonly events: Array<
    | { kind: "prompt"; id: string; text: string }
    | { kind: "message"; message: SDKMessage }
  > = [];
  readonly asks: Ask[] = [];
  readonly wire: Wire[] = [];
  readonly q: Query;
  /** The first `init` this session sent. */
  init: Msg | undefined;
  /** Stopped because its scenario's turn budget was spent: nothing more can be asked of it. */
  stoppedForBudget = false;
  /** `claude`'s process ID, as the check started it. */
  pid: number | undefined;
  stderrTail = "";
  private readonly input = new Input();
  private readonly done: Promise<void>;
  private listeners: Array<(message: Msg | null) => void> = [];
  private ended = false;
  private closing = false;

  readonly run: Run;
  readonly spec: SessionSpec;

  constructor(run: Run, spec: SessionSpec) {
    this.run = run;
    this.spec = spec;
    const launch: LaunchOptions = {
      advisor: spec.launch?.advisor ?? "off",
      focusView: spec.launch?.focusView ?? false,
      // Both always: the owner's saved defaults are another model and a high effort.
      model: "haiku",
      effort: "low",
    };
    const launched = sdkLaunchOptions(launch);
    const policy: ToolPolicy = { ...spec.policy, folder: run.folder };
    const canUseTool: CanUseTool = async (toolName, input) => {
      spec.onAsk?.(toolName, input);
      const decision = decideTool(policy, toolName, input);
      this.asks.push({ toolName, input, decision: decision.behavior });
      return decision.behavior === "allow"
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: decision.message };
    };
    this.q = query({
      prompt: this.input,
      options: {
        pathToClaudeCodeExecutable: run.claude,
        cwd: run.folder,
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        enableFileCheckpointing: true,
        canUseTool,
        perTaskStopAffordance: true,
        onElicitation: async () => ({ action: "decline" }),
        // The shipped launch options: model, effort, advisor and Focus view, and the
        // environment's additions (the SDK is told to report each turn's state).
        ...(launched.model ? { model: launched.model } : {}),
        ...(launched.effort ? { effort: launched.effort } : {}),
        extraArgs: launched.extraArgs,
        // Only the owner's own settings files stay out of reach: these are for this session.
        settings: {
          ...launched.settings,
          disableClaudeAiConnectors: true,
          ...spec.extraSettings,
        },
        env: {
          ...claudeEnvironment(process.env, {
            ...(run.fake ? { configDir: run.configDir } : {}),
            advisorOff: spec.advisorOff ?? launch.advisor === "off",
          }),
        },
        // Rails the shipped session does not have.
        strictMcpConfig: true,
        permissionMode: spec.permissionMode ?? "default",
        disallowedTools: blockedTools({
          ...spec.blocked,
          fromRules: run.settings.denyToo,
          bash: spec.blocked?.bash === true && !run.settings.bashCovered,
        }),
        maxTurns: spec.maxTurns ?? 6,
        maxBudgetUsd: 0.5,
        ...(spec.agents ? { agents: spec.agents } : {}),
        ...(spec.resume ? { resume: spec.resume } : {}),
        spawnClaudeCodeProcess: (options) => this.spawnClaude(options),
      },
    });
    this.done = this.pump();
    run.sessions.add(this);
    run.abort.signal.addEventListener("abort", () => this.kill(), { once: true });
  }

  private spawnClaude(options: {
    command: string;
    args: string[];
    cwd?: string | undefined;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }) {
    const child: ChildProcess = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group: `killGroup` ends it and whatever it started.
      detached: true,
    });
    this.pid = child.pid;
    const { pid } = child;
    if (pid !== undefined) {
      this.run.pids.add(pid);
      // The ID of a process that has gone is not kept: it may be another process's by the end.
      child.on("exit", () => this.run.pids.delete(pid));
    }
    const tap = (dir: Wire["dir"]) =>
      lines((line) => {
        try {
          this.wire.push({ dir, message: JSON.parse(line) as Msg });
        } catch {
          // Not a message: nothing to record.
        }
      });
    const readOut = tap("out");
    const readIn = tap("in");
    // A write to a process that has gone, or a read cut short, is the SDK's to hear of through
    // its exit, not an error that ends the script.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on("error", () => {});
    }
    const stdout = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        readOut(chunk);
        done(null, chunk);
      },
    });
    (child.stdout as Readable).pipe(stdout);
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, done) {
        readIn(chunk);
        (child.stdin as Writable).write(chunk, done);
      },
      final(done) {
        (child.stdin as Writable).end(done);
      },
    });
    stdin.on("error", () => {});
    stdout.on("error", () => {});
    (child.stderr as Readable).on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-2000);
    });
    options.signal.addEventListener("abort", () => killGroup(child.pid, "SIGTERM"), {
      once: true,
    });
    return {
      stdin,
      stdout,
      get killed() {
        return child.killed;
      },
      get exitCode() {
        return child.exitCode;
      },
      get signalCode() {
        return child.signalCode;
      },
      kill: (signal: NodeJS.Signals) => child.kill(signal),
      on: ((event: "exit" | "error", listener: never) =>
        child.on(event, listener)) as ChildProcess["on"],
      once: ((event: "exit" | "error", listener: never) =>
        child.once(event, listener)) as ChildProcess["once"],
      off: ((event: "exit" | "error", listener: never) =>
        child.off(event, listener)) as ChildProcess["off"],
    };
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.q) {
        const m = message as unknown as Msg;
        this.msgs.push(m);
        this.events.push({ kind: "message", message });
        this.observe(m);
        for (const listener of [...this.listeners]) listener(m);
      }
    } catch (error) {
      if (!this.closing) {
        this.msgs.push({
          type: "live_check_error",
          error: error instanceof Error ? error.message.slice(0, 300) : "failed",
        });
      }
    } finally {
      this.ended = true;
      for (const listener of [...this.listeners]) listener(null);
    }
  }

  /** The rails that watch every message. */
  private observe(m: Msg): void {
    if (typeof m.session_id === "string") this.run.sessionIds.add(m.session_id);
    if (m.type === "system" && m.subtype === "init" && this.init === undefined) {
      this.init = m;
      const problem = modelProblem(m);
      if (problem) this.run.fail(problem);
    }
    if (m.type === "result") {
      this.run.budget.resultSeen(this.spec.name);
      if (this.run.budget.exhausted) {
        this.run.stopForBudget(
          `the run's turn budget (${this.run.budget.cap}) is spent: stopped at once`,
        );
      } else if (this.run.budget.scopeExhausted(this.spec.name)) {
        // This scenario's own limit: its session ends, the run goes on.
        this.run.say(
          `  the budget of "${this.spec.name}" is spent: its session is stopped`,
        );
        this.stoppedForBudget = true;
        this.kill();
      }
    }
  }

  /** The first message from `from` that `match` accepts; null if none comes in time or the session ends. Rejects when the run is aborted. */
  next(
    match: (message: Msg) => boolean,
    timeoutMs = 120_000,
    from = 0,
  ): Promise<Msg | null> {
    return new Promise<Msg | null>((resolve, reject) => {
      const aborted = () => reject(new RunAborted(this.run.abortReason ?? "aborted"));
      if (this.run.abort.signal.aborted) return aborted();
      for (let i = from; i < this.msgs.length; i++) {
        const found = this.msgs[i];
        if (found && match(found)) return resolve(found);
      }
      if (this.ended) return resolve(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      const listener = (message: Msg | null) => {
        if (message === null || match(message)) finish(message);
      };
      const finish = (value: Msg | null) => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listener);
        this.run.abort.signal.removeEventListener("abort", aborted);
        resolve(value);
      };
      this.run.abort.signal.addEventListener("abort", aborted, { once: true });
      this.listeners.push(listener);
    });
  }

  /** Sends a prompt as k-bench does (`uuid` set by the client). Books one turn first; throws `BudgetExhausted` if it does not fit. Returns the index to wait from. */
  send(text: string, uuid: string = randomUUID()): number {
    if (this.run.abort.signal.aborted)
      throw new RunAborted(this.run.abortReason ?? "aborted");
    this.run.budget.reserve(this.spec.name);
    const from = this.msgs.length;
    this.events.push({ kind: "prompt", id: uuid, text });
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage["uuid"],
    });
    return from;
  }

  /**
   * One prompt, until Claude Code says its command is over (`command_lifecycle` `completed`
   * or `cancelled` for the prompt's `uuid`, which every prompt of the recorded runs got), and
   * the last `result` before that. A `result` alone is not the end of a prompt: a background
   * task that finishes starts a turn nobody sent, whose `result` would be taken for it.
   */
  async turn(
    text: string,
    options: { uuid?: string; timeoutMs?: number } = {},
  ): Promise<{ result: Msg | null; msgs: Msg[]; from: number }> {
    const uuid = options.uuid ?? randomUUID();
    const from = this.send(text, uuid);
    const over = await this.next(
      (m) =>
        m.type === "command_lifecycle" &&
        m.command_uuid === uuid &&
        (m.state === "completed" || m.state === "cancelled"),
      options.timeoutMs,
      from,
    );
    const upto = over ? this.msgs.indexOf(over) + 1 : this.msgs.length;
    const result = this.msgs.slice(from, upto).filter(isResult).at(-1) ?? null;
    return { result, msgs: this.msgs.slice(from), from };
  }

  /** Waits until Claude Code says each of these prompts' commands is over; returns how many were, after at most `timeoutMs`. */
  async waitForCompleted(
    uuids: readonly string[],
    from: number,
    timeoutMs: number,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    const done = new Set<string>();
    while (done.size < uuids.length) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const found = await this.next(
        (m) =>
          m.type === "command_lifecycle" &&
          typeof m.command_uuid === "string" &&
          uuids.includes(m.command_uuid) &&
          !done.has(m.command_uuid) &&
          (m.state === "completed" || m.state === "cancelled"),
        left,
        from,
      );
      if (!found) break;
      done.add(String(found.command_uuid));
    }
    return done.size;
  }

  /** Waits until Claude Code says it is idle (the latest `session_state_changed`), for a turn that starts by itself. */
  async settled(timeoutMs: number): Promise<boolean> {
    const state = () =>
      this.msgs.filter((m) => isSystem(m, "session_state_changed")).at(-1)?.state;
    if (state() === "idle") return true;
    const found = await this.next(
      (m) => isSystem(m, "session_state_changed") && m.state === "idle",
      timeoutMs,
      this.msgs.length,
    );
    return found !== null;
  }

  /** Stops the turn that is running, if any. */
  async interrupt(): Promise<void> {
    try {
      await this.q.interrupt();
    } catch {
      // Gone, or nothing running.
    }
  }

  /** Ends the session: its input is closed, `claude` asked to exit and then killed with everything it started. */
  async close(): Promise<void> {
    this.closing = true;
    this.input.close();
    try {
      this.q.close();
    } catch {
      // Already closed.
    }
    await Promise.race([this.done, new Promise((resolve) => setTimeout(resolve, 5000))]);
    killGroup(this.pid);
    this.killWhatItStarted();
    this.run.sessions.delete(this);
  }

  /** The quickest end there is, for an aborted run or a budget stop. */
  kill(): void {
    this.closing = true;
    this.input.close();
    try {
      this.q.close();
    } catch {
      // Already closed.
    }
    killGroup(this.pid);
    this.killWhatItStarted();
  }

  /**
   * A command `claude` ran in the background has a process group of its own, which killing
   * `claude`'s group does not reach: whatever works in the throwaway folder is ended too, so
   * that nothing is left for the end of the run to find.
   */
  private killWhatItStarted(): void {
    for (const pid of processesIn(this.run.folder)) killGroup(pid);
  }

  /** The recording: every message either way, redacted, as JSON lines. */
  recording(): string[] {
    const keep = (m: Msg) =>
      m.type !== "keep_alive" &&
      (m.type !== "stream_event" ||
        m.user_message_uuid !== undefined ||
        m.user_message_uuids !== undefined);
    const wire =
      this.wire.length > 0
        ? this.wire.filter((entry) => keep(entry.message))
        : this.msgs.filter(keep).map((message) => ({ dir: "out" as const, message }));
    const out = wire.map((entry) =>
      JSON.stringify({
        dir: entry.dir,
        message: JSON.parse(recordableLine(entry.message, this.run.places)),
      }),
    );
    for (const ask of this.asks) {
      out.push(
        JSON.stringify({
          dir: "callback",
          canUseTool: { tool: ask.toolName, decision: ask.decision },
        }),
      );
    }
    return out;
  }
}

export { BudgetExhausted };

// ---- Reading messages ------------------------------------------------------------------

export const isInit = (m: Msg) => m.type === "system" && m.subtype === "init";
export const isResult = (m: Msg) => m.type === "result";
export const isSystem = (m: Msg, subtype: string) =>
  m.type === "system" && m.subtype === subtype;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The content blocks of a message. */
export function blocks(m: Msg): Msg[] {
  const inner = isObject(m.message) ? m.message : {};
  const content = inner.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content.filter(isObject) as Msg[]) : [];
}

/** The text of the assistant messages among `msgs`. */
export function assistantText(msgs: readonly Msg[]): string {
  return msgs
    .filter((m) => m.type === "assistant")
    .flatMap((m) =>
      blocks(m)
        .filter((b) => b.type === "text")
        .map((b) => String(b.text)),
    )
    .join("\n");
}

/** The tool calls among `msgs`. */
export function toolCalls(
  msgs: readonly Msg[],
): Array<{ name: string; input: Msg; id: string }> {
  return msgs
    .filter((m) => m.type === "assistant")
    .flatMap((m) =>
      blocks(m)
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          name: String(b.name),
          input: isObject(b.input) ? b.input : {},
          id: String(b.id),
        })),
    );
}

/** `type/subtype` of each message, for a list of what a turn sent. */
export function kindsOf(msgs: readonly Msg[]): string[] {
  return [...new Set(msgs.map((m) => `${m.type}${m.subtype ? `/${m.subtype}` : ""}`))];
}
