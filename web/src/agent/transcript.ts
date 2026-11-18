import type {
  AgentServerMessage,
  AgentSnapshot,
  LogEntry,
} from "../../../src/shared/agent-protocol.ts";

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
  /** A prompt the owner sent (from any device). */
  | { kind: "prompt"; key: string; text: string }
  /** Text from Claude: complete, or still streaming in. */
  | { kind: "assistant"; key: string; text: string; streaming: boolean };

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

/** The conversation to show, in order: what the log holds, then what is still streaming in. */
export function transcriptItems(state: TranscriptState): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const entry of state.entries) {
    if (entry.kind === "prompt") {
      items.push({ kind: "prompt", key: `entry-${entry.seq}`, text: entry.text });
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
