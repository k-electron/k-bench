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
  /** An Allow/Deny that Claude Code is waiting on (written from ticket #135 on). */
  | (LogEntryBase & {
      kind: "permission_asked";
      requestId: string;
      toolName: string;
      input: unknown;
    })
  /** How a `permission_asked` ended (written from ticket #135 on). */
  | (LogEntryBase & {
      kind: "permission_answered";
      requestId: string;
      answer: unknown;
    });

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
}

/** What the Agent is doing, pushed to every connection whenever it changes (and on connect). */
export interface AgentStatus {
  type: "status";
  state: "idle" | "working";
}

/** Entries the client asked for with `sync`, in order. */
export interface AgentReplay {
  type: "replay";
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
   */
  | { type: "sync"; afterSeq: number }
  /**
   * A prompt to send to Claude Code as typed. `id` is a UUID chosen by the client; it goes
   * to Claude Code as the message's `uuid`, which Claude Code echoes back when it takes the
   * message up. Prompts are never marked as composed by the client, so `@path` works.
   */
  | { type: "prompt"; id: string; text: string }
  /** Ends the Agent: the turn is interrupted, the log finished, Claude Code closed. */
  | { type: "shutdown" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest `text` a prompt may carry. */
export const MAX_PROMPT_CHARACTERS = 1_000_000;

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
    case "sync":
      return typeof message.afterSeq === "number" &&
        Number.isInteger(message.afterSeq) &&
        message.afterSeq >= 0
        ? { type: "sync", afterSeq: message.afterSeq }
        : undefined;
    case "prompt":
      return typeof message.id === "string" &&
        UUID.test(message.id) &&
        typeof message.text === "string" &&
        message.text.trim() !== "" &&
        message.text.length <= MAX_PROMPT_CHARACTERS
        ? { type: "prompt", id: message.id, text: message.text }
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
