import {
  type AgentServerMessage,
  type AgentSnapshot,
  type LogEntry,
  openPermissionAsks,
} from "../../../src/shared/agent-protocol.ts";
import { queuedPromptIds } from "./prompts";

/**
 * What the conversation shows, built from the Agent's log entries and live fragments. This
 * is the one place SDK messages become something to display, so a display fix lands with the
 * next page load (ADR-0008). Pure: no React, no DOM. Ticket #136 gives it Claude Code's
 * real shape; for now it is plain text, the prompts typed and Claude's text replies.
 *
 * Every later kind of thing the conversation shows is a new `TranscriptItem` kind, built by
 * `transcriptItems` from entries the state already holds.
 */
export type TranscriptItem =
  /**
   * A prompt the owner sent (from any device). `queued` while Claude Code has not picked it
   * up yet: it was sent during a turn (or an instant ago) and waits its turn.
   */
  | { kind: "prompt"; key: string; seq?: number; text: string; queued: boolean }
  /** The turn before this ended because the owner interrupted it. */
  | { kind: "interrupted"; key: string; seq?: number }
  /** Text from Claude: complete, or still streaming in. */
  | { kind: "assistant"; key: string; seq?: number; text: string; streaming: boolean };

/**
 * **The raw-message seam (#137).** An item built from a log entry carries that entry's `seq`
 * (`TranscriptItem.seq`), so the Pane can offer that message's raw JSON (`web/src/agent/raw.ts`,
 * `components/agent/RawView.tsx`). Text still streaming in has no entry yet and no `seq`. Every
 * item kind a later ticket adds must set `seq` the same way, from the entry it was built from;
 * a row built from several entries sets the one the owner would call "the message".

/** Text streaming in for the SDK message now being written. */
interface LiveMessage {
  /** The Messages API message ID the fragments belong to. */
  id: string;
  /** Streamed text so far, by content block index. */
  blocks: Map<number, { type: string; text: string }>;
  /**
   * How many of this message's blocks have arrived complete. Claude Code sends one complete
   * `assistant` message per content block, in order, so blocks below this are no longer
   * shown from their fragments.
   */
  completeBlocks: number;
}

/** Everything the conversation knows. Treat as immutable: every function returns a new one. */
export interface TranscriptState {
  /** The log entries received, in order. */
  entries: readonly LogEntry[];
  /** The newest `seq` in `entries`: anything not above it is already held. */
  lastSeq: number;
  live: LiveMessage | undefined;
}

export const emptyTranscript: TranscriptState = {
  entries: [],
  lastSeq: 0,
  live: undefined,
};

interface StreamEvent {
  type?: string;
  index?: number;
  message?: { id?: string };
  content_block?: { type?: string };
  delta?: { type?: string; text?: string };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Takes in the entries of `entries` that are new, in order. */
function addEntries(
  state: TranscriptState,
  entries: readonly LogEntry[],
): TranscriptState {
  const fresh = entries.filter((entry) => entry.seq > state.lastSeq);
  if (fresh.length === 0) return state;
  let live = state.live;
  for (const entry of fresh) {
    if (entry.kind !== "sdk") continue;
    const { message } = entry;
    if (message.type === "result") {
      live = undefined;
    } else if (
      message.type === "assistant" &&
      message.parent_tool_use_id == null &&
      live &&
      isObject(message.message) &&
      message.message.id === live.id
    ) {
      live = { ...live, completeBlocks: live.completeBlocks + 1 };
    }
  }
  return {
    entries: [...state.entries, ...fresh],
    lastSeq: fresh[fresh.length - 1]?.seq ?? state.lastSeq,
    live,
  };
}

/** Takes in one live `stream_event`. */
function addFragment(
  state: TranscriptState,
  message: Record<string, unknown>,
): TranscriptState {
  // Fragments of a subagent's messages are never shown live.
  if (message.parent_tool_use_id != null) return state;
  const event = message.event as StreamEvent | undefined;
  if (!event) return state;
  switch (event.type) {
    case "message_start":
      return event.message?.id === undefined
        ? state
        : {
            ...state,
            live: { id: event.message.id, blocks: new Map(), completeBlocks: 0 },
          };
    case "content_block_start": {
      if (!state.live || event.index === undefined) return state;
      const blocks = new Map(state.live.blocks);
      blocks.set(event.index, { type: event.content_block?.type ?? "", text: "" });
      return { ...state, live: { ...state.live, blocks } };
    }
    case "content_block_delta": {
      const block =
        event.index === undefined ? undefined : state.live?.blocks.get(event.index);
      if (!state.live || event.index === undefined || !block) return state;
      if (event.delta?.type !== "text_delta" || event.delta.text === undefined) {
        return state;
      }
      const blocks = new Map(state.live.blocks);
      blocks.set(event.index, { ...block, text: block.text + event.delta.text });
      return { ...state, live: { ...state.live, blocks } };
    }
    case "message_stop":
      return { ...state, live: undefined };
    default:
      return state;
  }
}

/**
 * Takes in the snapshot of the text streaming now, which comes right after a replay. A client
 * that joined mid-message already holds some of that message's blocks complete (in the
 * replay), and those are not shown from the snapshot.
 */
function addSnapshot(state: TranscriptState, snapshot: AgentSnapshot): TranscriptState {
  const completeBlocks = state.entries.filter(
    (entry) =>
      entry.kind === "sdk" &&
      entry.message.type === "assistant" &&
      entry.message.parent_tool_use_id == null &&
      isObject(entry.message.message) &&
      entry.message.message.id === snapshot.messageId,
  ).length;
  return {
    ...state,
    live: {
      id: snapshot.messageId,
      blocks: new Map(
        snapshot.blocks.map(({ index, type, text }) => [index, { type, text }]),
      ),
      completeBlocks,
    },
  };
}

/** The state after a message from the runtime. Messages that are not the conversation change nothing. */
export function applyServerMessage(
  state: TranscriptState,
  message: AgentServerMessage,
): TranscriptState {
  switch (message.type) {
    case "replay":
      // Text streamed before a drop is stale: if a message is still streaming, a snapshot
      // follows this replay, and if not, the entries replayed hold what it became.
      return addEntries({ ...state, live: undefined }, message.entries);
    case "snapshot":
      return addSnapshot(state, message);
    case "entry":
      return addEntries(state, [message.entry]);
    case "partial":
      return addFragment(state, message.message);
    default:
      return state;
  }
}

/**
 * Claude Code's note that the owner interrupted: a synthetic `user` message, "[Request
 * interrupted by user]" (or "... for tool use" when a tool was running), that closes the
 * aborted turn.
 */
function isInterruptNotice(entry: LogEntry): boolean {
  if (entry.kind !== "sdk" || entry.message.type !== "user") return false;
  if (entry.message.parent_tool_use_id != null || !isObject(entry.message.message)) {
    return false;
  }
  const { content } = entry.message.message;
  const blocks = Array.isArray(content) ? content : [{ type: "text", text: content }];
  return blocks.some(
    (block) =>
      isObject(block) &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.startsWith("[Request interrupted by user"),
  );
}

/** The conversation to show, in order: what the log holds, then what is still streaming in. */
export function transcriptItems(state: TranscriptState): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const queued = queuedPromptIds(state.entries);
  for (const entry of state.entries) {
    if (entry.kind === "prompt") {
      items.push({
        kind: "prompt",
        key: `entry-${entry.seq}`,
        seq: entry.seq,
        text: entry.text,
        queued: queued.has(entry.id),
      });
    } else if (isInterruptNotice(entry)) {
      items.push({ kind: "interrupted", key: `entry-${entry.seq}`, seq: entry.seq });
    } else if (
      entry.kind === "sdk" &&
      entry.message.type === "assistant" &&
      entry.message.parent_tool_use_id == null
    ) {
      const content = isObject(entry.message.message)
        ? entry.message.message.content
        : [];
      (Array.isArray(content) ? content : []).forEach((block: unknown, index) => {
        if (isObject(block) && block.type === "text" && typeof block.text === "string") {
          items.push({
            kind: "assistant",
            key: `entry-${entry.seq}-${index}`,
            seq: entry.seq,
            text: block.text,
            streaming: false,
          });
        }
      });
    }
  }
  const { live } = state;
  if (live) {
    for (const [index, block] of [...live.blocks].sort(([a], [b]) => a - b)) {
      if (index >= live.completeBlocks && block.type === "text" && block.text !== "") {
        items.push({
          kind: "assistant",
          key: `live-${live.id}-${index}`,
          text: block.text,
          streaming: true,
        });
      }
    }
  }
  return items;
}

/**
 * An Allow/Deny Claude Code is waiting on, as the Pane shows it: what the log's
 * `permission_asked` entry says, without its numbering. It is open from the moment its entry
 * arrives until the ask's `permission_answered` does, on every device alike: **the card never
 * goes by a local decision**, only when that entry arrives, so the device whose answer came
 * second sees it go exactly as the others do. Ticket #146 shows more of it (the diff, "don't
 * ask again" from `suggestions`); #147 renders the questions and the plan.
 */
export interface PermissionAsk {
  /** What an `answer` names. */
  requestId: string;
  toolName: string;
  /** The tool's input as Claude Code sent it. */
  input: Record<string, unknown>;
  /** Claude Code's sentence for the ask ("Claude wants to read foo.txt"), if it gave one. */
  title?: string;
  description?: string;
  blockedPath?: string;
  /** The rule changes "don't ask again" would apply; the runtime holds the same ones. */
  suggestions: readonly unknown[];
  suppressAlwaysAllowRule: boolean;
  defaultToNo: boolean;
}

/**
 * The asks open now, oldest first (a subagent can ask while another ask is open, so there
 * may be several; the Pane shows the first). They come from the log alone, so a device that
 * connects, reloads or reconnects while one is open shows it, from its replay.
 */
export function permissionAsks(state: TranscriptState): PermissionAsk[] {
  return openPermissionAsks(state.entries).map((entry) => ({
    requestId: entry.requestId,
    toolName: entry.toolName,
    input: entry.input,
    ...(entry.title === undefined ? {} : { title: entry.title }),
    ...(entry.description === undefined ? {} : { description: entry.description }),
    ...(entry.blockedPath === undefined ? {} : { blockedPath: entry.blockedPath }),
    suggestions: entry.suggestions ?? [],
    suppressAlwaysAllowRule: entry.suppressAlwaysAllowRule ?? false,
    defaultToNo: entry.defaultToNo ?? false,
  }));
}
