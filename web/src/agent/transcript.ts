import {
  type AgentServerMessage,
  type AgentSnapshot,
  type LogEntry,
  openPermissionAsks,
} from "../../../src/shared/agent-protocol.ts";
import { type BuiltTranscript, buildItems, type TranscriptItem } from "./items";

export type { TranscriptItem } from "./items";

/**
 * What the conversation holds: the Agent's log entries and the live fragments, and the
 * functions that take messages in. This is where SDK messages are kept; `items.ts` is where
 * they become something to display (`buildItems`), so a display fix lands with the next page
 * load (ADR-0008). Pure: no React, no DOM. `transcriptItems(state)` is the conversation to
 * show: what the log makes, then what is still streaming in. How to add a new kind of item is
 * at the top of `items.ts`.
 */

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
 * What the entries make, kept for as long as the entries array is the same one: the array is
 * replaced only when entries arrive, so a stream of fragments does not rebuild the whole
 * history (nor re-render it: the items keep their identity).
 */
const built = new WeakMap<readonly LogEntry[], BuiltTranscript>();

function builtTranscript(state: TranscriptState): BuiltTranscript {
  let result = built.get(state.entries);
  if (!result) {
    result = buildItems(state.entries);
    built.set(state.entries, result);
  }
  return result;
}

/** The text still streaming in, as the items it will become when its complete message arrives. */
function liveItems(live: LiveMessage): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const [index, block] of [...live.blocks].sort(([a], [b]) => a - b)) {
    if (index < live.completeBlocks) continue;
    const key = `live-${live.id}-${index}`;
    if (block.type === "text" && block.text !== "") {
      items.push({ kind: "assistant", key, text: block.text, streaming: true });
    } else if (block.type === "thinking" || block.type === "redacted_thinking") {
      items.push({ kind: "thinking", key, streaming: true });
    }
  }
  return items;
}

/** The conversation to show, in order: what the log makes, then what is still streaming in. */
export function transcriptItems(state: TranscriptState): TranscriptItem[] {
  const { items } = builtTranscript(state);
  return state.live ? [...items, ...liveItems(state.live)] : items;
}

/** What the header knows from the log: the model and folder of the latest turn. */
export function transcriptInfo(state: TranscriptState): { model?: string; cwd?: string } {
  const { model, cwd } = builtTranscript(state);
  return {
    ...(model === undefined ? {} : { model }),
    ...(cwd === undefined ? {} : { cwd }),
  };
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
