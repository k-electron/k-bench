/**
 * The Claude Agent wire protocol, the one definition the Agent Runtime, the server, the
 * browser and the test harness all use (docs/internals/agent.md describes it in prose).
 *
 * The same JSON messages travel on two connections, which the server joins without reading
 * what passes: one message per newline-delimited line on the runtime's unix socket, one per
 * text frame on the browser's WebSocket (`GET /api/sessions/:id/agent`, see `agentPath`).
 *
 * The protocol has a number and only grows by additions within it: a new message type, or a
 * new optional field, never a changed one. Whoever receives a `type` it does not know ignores
 * it. A change that cannot be made that way bumps `AGENT_PROTOCOL_VERSION`, and the browser
 * speaks only the current number (ADR-0008).
 *
 * Imported by the browser too, so this file has no imports and no Node APIs.
 */

/** The protocol's number. A client that sees another number in `hello` must not carry on. */
export const AGENT_PROTOCOL_VERSION = 1;

/**
 * The agent socket was closed because the Session ended (deleted, Stopped, or never was a
 * Claude Agent): reconnecting is pointless. The same code as the terminal socket's.
 */
export const CLOSE_AGENT_SESSION_ENDED = 4410;

const AGENT_PATH = /^\/api\/sessions\/([^/]+)\/agent$/;

/** The path of a Claude Agent Session's WebSocket. */
export function agentPath(sessionId: string): string {
  return `/api/sessions/${sessionId}/agent`;
}

/** The Session a request URL opens the agent WebSocket of, or undefined when it is not one. */
export function parseAgentPath(url: string): string | undefined {
  const { pathname } = new URL(url, "http://localhost");
  return AGENT_PATH.exec(pathname)?.[1];
}

// ---- The log -----------------------------------------------------------------------------

/**
 * What every log entry has. The Agent's log is append-only; `seq` counts from 1 with no gaps
 * and carries on across runtime restarts, and `t` is when the entry was written (ISO 8601).
 */
interface LogEntryBase {
  seq: number;
  t: string;
}

/**
 * Entries by `kind`. Everything the runtime appends is one of these; a reader ignores a kind
 * it does not know. Partial text fragments are never logged.
 */
export type LogEntry =
  /** An SDK message, byte for byte as the SDK yielded it (`message`), except `stream_event`s. */
  | (LogEntryBase & { kind: "sdk"; message: Record<string, unknown> })
  /**
   * A prompt k-bench sent to Claude Code. Logged before it is sent, because no echo of it
   * exists until Claude Code picks it up. `id` is the client-set ID the SDK echoes back.
   */
  | (LogEntryBase & { kind: "prompt"; id: string; text: string })
  /** Written by the runtime itself: when it started and why it stopped. */
  | (LogEntryBase & { kind: "runtime"; event: "started" | "stopped"; reason?: string })
  /**
   * Something Claude Code asked of k-bench that the runtime declined, because a Claude Agent
   * has no way to answer it (#153). The browser shows it as an Unsupported row where it
   * happened. `request` is what Claude Code sent, as the SDK handed it over, so the log holds
   * what was asked even for fields no row shows yet. A reader that does not know `what`
   * shows nothing.
   */
  | (LogEntryBase & {
      kind: "declined";
      /** What was declined: `elicitation`, an MCP server asking the owner for input. */
      what: "elicitation";
      request: Record<string, unknown>;
    })
  /**
   * An Allow/Deny that Claude Code is waiting on: written when it asks, and open until a
   * `permission_answered` with the same `requestId` follows (see `openPermissionAsks`).
   * Every field of the SDK's `canUseTool` request that can be serialised is kept, because the
   * log is permanent and a later ticket (#146, #147) cannot add a field to asks already on
   * disk. `input` is the tool's input exactly as Claude Code sent it.
   */
  | (LogEntryBase & {
      kind: "permission_asked";
      /** Claude Code's ID for the ask: what an `answer` names. Unique per ask. */
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      /** The tool call the ask is about: the `id` of its `tool_use` block. */
      toolUseId: string;
      /** Claude Code's full sentence for the ask ("Claude wants to read foo.txt"). */
      title?: string;
      /** A short name for the action ("Read file"). */
      displayName?: string;
      /** A subtitle for the ask. */
      description?: string;
      /** The path that caused the ask, if one did. */
      blockedPath?: string;
      /** Why Claude Code asks. */
      decisionReason?: string;
      /**
       * The rule changes "Yes, don't ask again" would apply: the SDK's `PermissionUpdate`s as
       * Claude Code sent them, so that an `alwaysAllow` answer (#146) can echo them back.
       * Never sent by a client.
       */
      suggestions?: unknown[];
      /** Claude Code says the ask must not offer a persistent "don't ask again". */
      suppressAlwaysAllowRule?: boolean;
      /** Claude Code says the ask must open on its decline option. */
      defaultToNo?: boolean;
      /** The subagent that asks, when one does. */
      agentId?: string;
    })
  /** How an ask ended (see `PermissionAnswer`). Written once per ask, by the runtime only. */
  | (LogEntryBase & {
      kind: "permission_answered";
      requestId: string;
      answer: PermissionAnswer;
    });

/**
 * How an ask ended. `allow` and `deny` are the owner's answer, from whichever device came
 * first. The others were nobody's answer: `cancelled` is Claude Code withdrawing the ask (the
 * turn was interrupted, the tool call gone), and `interrupted` is the runtime ending, or
 * finding at its next start that the previous one ended, while the ask was open: it could
 * never be answered ("not answered, the Agent stopped"). Later tickets add fields to `allow`
 * and `deny` (#146, #147), never new meanings to a `decision`.
 */
export type PermissionAnswer =
  | { decision: "allow" }
  | { decision: "deny" }
  | { decision: "cancelled" }
  | { decision: "interrupted" };

/** A `permission_asked` entry. */
export type PermissionAskEntry = Extract<LogEntry, { kind: "permission_asked" }>;

/**
 * The asks still open in these entries, oldest first: each `permission_asked` whose
 * `requestId` has no `permission_answered`. The one definition of "open" that the runtime
 * (which closes the ones a dead runtime left) and the browser (which shows them) share.
 */
export function openPermissionAsks(entries: readonly LogEntry[]): PermissionAskEntry[] {
  const open = new Map<string, PermissionAskEntry>();
  for (const entry of entries) {
    if (entry.kind === "permission_asked") open.set(entry.requestId, entry);
    else if (entry.kind === "permission_answered") open.delete(entry.requestId);
  }
  return [...open.values()];
}

/** An entry as the runtime appends it: the log numbers and stamps it. */
export type NewLogEntry = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, "seq" | "t">
    : never
  : never;

// ---- Runtime to client -------------------------------------------------------------------

/**
 * The first message on every connection. `claudeVersion` is what the installed `claude`
 * reported to the runtime, so the runtime listens only once it knows it.
 */
export interface AgentHello {
  type: "hello";
  protocol: number;
  /** The SHA-256 of the runtime's own file: which build of the runtime this is. */
  runtimeBuildId: string;
  claudeVersion: string;
  /** The Agent SDK version bundled in the runtime. */
  sdkVersion: string;
  /** The Claude Code version that SDK release was made for. */
  sdkClaudeCodeVersion: string;
  /**
   * The folder Claude Code runs in, for the Transcript's header before the first turn: Claude
   * Code reports `cwd` only in each turn's `system/init`. Absent from a runtime that predates it.
   */
  folder?: string;
}

/**
 * How full Claude Code's context is, as it reported (`getContextUsage()`), reduced to the
 * few numbers the Transcript shows. Claude Code does not push this, so the runtime asks after
 * each turn. The browser works out "context left until auto-compact" from it, so a wrong
 * formula is a display fix.
 */
export interface AgentContextUsage {
  /** Tokens in the context now. */
  totalTokens: number;
  /** The context window. */
  maxTokens: number;
  /** Share of the window used, 0 to 100. */
  percentage: number;
  /** The size, in tokens, at which Claude Code compacts by itself; absent when it did not say. */
  autoCompactThreshold?: number;
  isAutoCompactEnabled: boolean;
}

/**
 * Claude Code's permission modes, as the SDK names them. A Claude Code started with the
 * owner's own settings can be in any of them; k-bench only ever switches among
 * `PERMISSION_MODE_CYCLE`.
 */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

/**
 * The modes Shift+Tab, and a tap on the mode line, step through, in the order Claude TUI
 * offers them. `bypassPermissions` is not here: it needs an explicit opt-in the owner makes
 * outside k-bench, and no client may switch it on. Nor is `auto`, which the TUI offers only
 * where it is enabled and which nothing tells k-bench about: adding it later is one line here.
 */
export const PERMISSION_MODE_CYCLE: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
];

/**
 * The mode after `current` in the cycle, wrapping round. A mode outside the cycle (the owner
 * started Claude Code in `auto`, say) goes to `default`, as the TUI's Shift+Tab does.
 */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  const index = PERMISSION_MODE_CYCLE.indexOf(current);
  return PERMISSION_MODE_CYCLE[index + 1] ?? PERMISSION_MODE_CYCLE[0] ?? "default";
}

/** What the mode line says for each mode. */
export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan mode",
  auto: "Auto mode",
  dontAsk: "Don't ask",
  bypassPermissions: "Bypass permissions",
};

const PERMISSION_MODES = Object.keys(PERMISSION_MODE_LABEL) as PermissionMode[];

/** Whether a value read off the wire is one of the modes. */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.includes(value as PermissionMode);
}

/** What the Agent is doing, pushed to every connection whenever it changes (and on connect). */
export interface AgentStatus {
  type: "status";
  /**
   * `working`: a turn is running, one the owner sent or one nobody did (`/loop`). `waiting`:
   * an Allow/Deny ask is open (it wins over `working`). The same three words as
   * `SessionState.agent.state`.
   */
  state: "idle" | "working" | "waiting";
  /**
   * When the turn now running began, in milliseconds since the epoch on the runtime's clock
   * (the Host's). Present while `working` or `waiting`, and kept across the two: it is the
   * clock of the turn, not of the wait.
   */
  turnStartedAt?: number;
  /**
   * Claude Code's permission mode now, whoever changed it: a client's `set_permission_mode`,
   * Claude Code itself (leaving plan mode), or the settings it started with. Absent only
   * from a runtime older than this field.
   */
  mode?: PermissionMode;
  /**
   * The Agent's Bell is raised: a turn ended, or an ask opened, while no device showed the
   * Agent on a visible page, and no device has shown it since (`view`). Absent when it is
   * not. Held by the runtime, so it outlives the server.
   */
  bell?: boolean;
  /**
   * How full Claude Code's context is, as it last said. Claude Code does not push this, so the
   * runtime asks at its start and after every turn. Absent until it has said, and for a Claude
   * Code that cannot (an older one).
   */
  context?: AgentContextUsage;
}

/**
 * Entries the client asked for with `sync`, in order. `from` is the first `seq` of the
 * contiguous range the replay covers, through to the newest entry: the whole log when it is 1.
 * What a `sync` with `tailTurns` leaves out is earlier than `from`, to be fetched with `page`.
 * Entries below `from` can also be here, first: the permission asks still open
 * (`openPermissionAsks`) that were made before it, so that an open ask is always known. A
 * replay without `from` (a runtime built before paging existed) covers everything after the
 * `afterSeq` asked.
 */
export interface AgentReplay {
  type: "replay";
  entries: LogEntry[];
  from?: number;
}

/**
 * The answer to a `page` request: the entries from `from` up to, but not including,
 * `beforeSeq` (which the request named, so a stale answer can be told), in order, with none
 * missing. `from` is 1 when the page reaches the start of the log.
 */
export interface AgentPage {
  type: "page";
  beforeSeq: number;
  from: number;
  entries: LogEntry[];
}

/** One entry appended since the client's `sync` was answered. */
export interface AgentEntry {
  type: "entry";
  entry: LogEntry;
}

/**
 * A live `stream_event` SDK message (text fragments as they stream). Never logged and
 * numbered by nothing; the complete message arrives later as an `entry`.
 */
export interface AgentPartial {
  type: "partial";
  message: Record<string, unknown>;
}

/**
 * The text so far of the message being streamed, sent once to a client that joins in the
 * middle of it (right after its `replay`), so it does not wait for the next fragment to see
 * what came before. The `partial`s that follow carry on from exactly here. Sent only while
 * a top-level message is streaming; a client holding stale streamed text drops it at every
 * `replay`, so no snapshot means nothing is streaming.
 */
export interface AgentSnapshot {
  type: "snapshot";
  /** The Messages API message ID the blocks belong to (its `message_start`). */
  messageId: string;
  /** Every content block started so far, in index order; `text` is what streamed into it. */
  blocks: Array<{ index: number; type: string; text: string }>;
}

/** A message the runtime refused, or a request it could not carry out. */
export interface AgentError {
  type: "error";
  code: "bad_message" | "already_synced";
  message: string;
}

export type AgentServerMessage =
  | AgentHello
  | AgentStatus
  | AgentReplay
  | AgentPage
  | AgentEntry
  | AgentPartial
  | AgentSnapshot
  | AgentError;

// ---- Client to runtime -------------------------------------------------------------------

export type AgentClientMessage =
  /**
   * Asks for every entry after `afterSeq` (0 for all of them), answered with one `replay`,
   * then, if a message is mid-stream, one `snapshot` of its text so far, then sends this
   * connection every `entry` and `partial` from the same moment on, with no gap and no
   * repeat. A connection that never syncs receives `hello` and `status` only.
   * Once per connection.
   *
   * `tailTurns`, for a client that holds nothing (`afterSeq` 0; ignored otherwise, since a
   * client that holds entries needs everything after them), limits the replay to the last
   * that many turns (see `AgentLog.readTail`) plus the permission asks still open from
   * before them. The replay says where it begins (`from`), and `page` fetches what is
   * earlier. A runtime that does not know `tailTurns` replays everything, with no `from`.
   */
  | { type: "sync"; afterSeq: number; tailTurns?: number }
  /**
   * Asks for the `limit` turns before `beforeSeq` (the `from` of what the client holds):
   * answered to this connection alone with a `page`. Entries before `beforeSeq` never
   * change, so a page needs no sync and cannot race the live entries.
   */
  | { type: "page"; beforeSeq: number; limit: number }
  /**
   * A prompt to send to Claude Code as typed. `id` is a UUID chosen by the client; it goes
   * to Claude Code as the message's `uuid`, which Claude Code echoes back when it takes the
   * message up. Prompts are never marked as composed by the client, so `@path` works.
   */
  | { type: "prompt"; id: string; text: string }
  /**
   * The owner's answer to an open ask. The runtime builds what Claude Code is sent from the
   * ask it holds, so a client says only which: it can never change the tool's input or the
   * rules to save. The first answer for a `requestId` wins; one for an ask that is no longer
   * open (answered on another device, withdrawn, never asked) is ignored, with no error.
   * What came of it arrives as the ask's `permission_answered` entry, to every device.
   */
  | { type: "answer"; requestId: string; decision: "allow" | "deny" }
  /**
   * Switches Claude Code to this permission mode. A target, not a "next": two devices that
   * both tap at once ask for the same mode, and it is set once. Only the modes of
   * `PERMISSION_MODE_CYCLE` are accepted. What came of it is the next `status`, on every
   * connection; if Claude Code refuses, nothing changes.
   */
  | { type: "set_permission_mode"; mode: PermissionMode }
  /**
   * Stops the turn that is running, as Esc does in a terminal: its text so far is kept, its
   * running tool ends unanswered, and the turn's `result` is an error. Prompts already sent
   * and waiting are not taken back: they run next, in the order sent. Harmless when nothing
   * is running.
   */
  | { type: "interrupt" }
  /**
   * Says whether this connection's page shows the Agent in a Pane right now: the page is
   * visible (not a background tab, not a locked phone) and the Pane is open. Sent when the
   * connection opens and whenever it changes; a connection that never says it, such as the
   * server's status connection, is not viewing. `visible: true` clears the Agent's Bell on
   * every device, and while any connection is visible nothing raises it. A connection that
   * closes stops viewing.
   */
  | { type: "view"; visible: boolean }
  /** Ends the Agent: the turn is interrupted, the log finished, Claude Code closed. */
  | { type: "shutdown" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most turns a `sync`'s `tailTurns` or a `page`'s `limit` may ask for. */
export const MAX_TURNS_PER_REQUEST = 200;

/** Whether `value` is an integer from `min` up to `max`. */
function isCount(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
  );
}

/** Longest `text` a prompt may carry. */
export const MAX_PROMPT_CHARACTERS = 1_000_000;

/** Longest `requestId` an answer may name. Claude Code's format is not ours to pin down. */
export const MAX_REQUEST_ID_CHARACTERS = 200;

/**
 * The message a client's text holds, or undefined when it is not a valid one. The runtime
 * checks every message it receives with this, so nothing a client sends reaches Claude Code
 * unchecked.
 */
export function decodeAgentClientMessage(text: string): AgentClientMessage | undefined {
  let message: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    message = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  switch (message.type) {
    case "sync": {
      if (!isCount(message.afterSeq, 0)) return undefined;
      if (message.tailTurns === undefined) {
        return { type: "sync", afterSeq: message.afterSeq };
      }
      return isCount(message.tailTurns, 1, MAX_TURNS_PER_REQUEST)
        ? { type: "sync", afterSeq: message.afterSeq, tailTurns: message.tailTurns }
        : undefined;
    }
    case "page":
      return isCount(message.beforeSeq, 1) &&
        isCount(message.limit, 1, MAX_TURNS_PER_REQUEST)
        ? { type: "page", beforeSeq: message.beforeSeq, limit: message.limit }
        : undefined;
    case "prompt":
      return typeof message.id === "string" &&
        UUID.test(message.id) &&
        typeof message.text === "string" &&
        message.text.trim() !== "" &&
        message.text.length <= MAX_PROMPT_CHARACTERS
        ? { type: "prompt", id: message.id, text: message.text }
        : undefined;
    case "answer":
      return typeof message.requestId === "string" &&
        message.requestId !== "" &&
        message.requestId.length <= MAX_REQUEST_ID_CHARACTERS &&
        (message.decision === "allow" || message.decision === "deny")
        ? { type: "answer", requestId: message.requestId, decision: message.decision }
        : undefined;
    case "set_permission_mode":
      return isPermissionMode(message.mode) &&
        PERMISSION_MODE_CYCLE.includes(message.mode)
        ? { type: "set_permission_mode", mode: message.mode }
        : undefined;
    case "interrupt":
      return { type: "interrupt" };
    case "view":
      return typeof message.visible === "boolean"
        ? { type: "view", visible: message.visible }
        : undefined;
    case "shutdown":
      return { type: "shutdown" };
    default:
      return undefined;
  }
}

export function encodeAgentClientMessage(message: AgentClientMessage): string {
  return JSON.stringify(message);
}

export function encodeAgentServerMessage(message: AgentServerMessage): string {
  return JSON.stringify(message);
}

const SERVER_TYPES: readonly string[] = [
  "hello",
  "status",
  "replay",
  "page",
  "entry",
  "partial",
  "snapshot",
  "error",
] satisfies AgentServerMessage["type"][];

/**
 * The message a runtime's text holds, or undefined when it is not one this protocol number
 * has (a type added later, or not JSON): such a message is ignored. Only the `type` is
 * checked; the runtime that wrote it is trusted.
 */
export function decodeAgentServerMessage(text: string): AgentServerMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      SERVER_TYPES.includes((parsed as { type?: string }).type as string)
    ) {
      return parsed as AgentServerMessage;
    }
  } catch {
    // Not JSON.
  }
  return undefined;
}
