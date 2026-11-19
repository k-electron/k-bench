/**
 * Open in web's import (#156, ADR-0008): what a Claude TUI did in the conversation while the
 * Session was in the terminal, read once from `getSessionMessages` and turned into log entries.
 * Pure: `main.ts` reads the messages and appends what this returns.
 *
 * The SDK returns the conversation's chain as Claude Code saved it. k-bench finds where it
 * left off by the IDs it already holds: the `id` of every prompt it sent (the client-set ID
 * Claude Code keeps as the message's `uuid`) and the `uuid` of every message already in the
 * log, which includes what an earlier import added, so that going back and forth imports each
 * turn once.
 */

import type { LogEntry, NewLogEntry } from "../shared/agent-protocol.ts";

/** What `getSessionMessages` returns for one message (with `includeSystemMessages`). */
export interface SavedMessage {
  type: "user" | "assistant" | "system";
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
}

export const IN_THE_TERMINAL = "In the terminal";
export const BACK_IN_WEB = "Back in web";
export const COMPACTED_IN_THE_TERMINAL =
  "Compacted in the terminal: earlier turns above are from before";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function blocksOf(message: SavedMessage): unknown[] {
  const content = isObject(message.message) ? message.message.content : undefined;
  return Array.isArray(content) ? content : [];
}

function textOf(message: SavedMessage): string {
  const content = isObject(message.message) ? message.message.content : undefined;
  if (typeof content === "string") return content;
  return blocksOf(message)
    .map((block) => (isObject(block) && typeof block.text === "string" ? block.text : ""))
    .join("");
}

/** A turn starts with what someone typed: not a tool's result, and not the interrupt note. */
function startsATurn(message: SavedMessage): boolean {
  if (message.type !== "user") return false;
  if (
    blocksOf(message).some((block) => isObject(block) && block.type === "tool_result")
  ) {
    return false;
  }
  return !textOf(message).startsWith("[Request interrupted by user");
}

/** The SDK's message as a log entry, shaped as the live user and assistant messages are. */
function asEntry(message: SavedMessage, options: { summary: boolean }): NewLogEntry {
  const sdk: Record<string, unknown> = {
    type: message.type,
    uuid: message.uuid,
    session_id: message.session_id,
    message: message.message,
    parent_tool_use_id: message.parent_tool_use_id,
  };
  // What someone typed shows as a prompt, as the echo of one k-bench sent does.
  if (startsATurn(message)) sdk.isReplay = true;
  // Claude Code's own summary of everything before it, which the Transcript shows as such.
  if (options.summary) sdk.isCompactSummary = true;
  return { kind: "sdk", message: sdk };
}

/**
 * The entries to append: nothing when the terminal added nothing, else a divider, the turns,
 * and a divider. `known` is everything the log already holds. The three ways the terminal
 * conversation is related to the log:
 * - **Found**: a message the log already has. The terminal's turns are everything after it;
 *   after one of k-bench's own prompts, that prompt's own reply comes first (it is in the log
 *   already) and is skipped up to the next thing someone typed.
 * - **Compacted**: none is found and the saved chain starts with a system message (the
 *   `compact_boundary`), so the terminal compacted and what k-bench sent is no longer in it. The import starts from
 *   Claude's summary, and the first divider says so.
 * - **Nothing to anchor on**: the log holds no message, as when the Session began as a Claude
 *   TUI. The whole conversation is imported.
 * Anything else (the log has messages and none is in the chain, with no compaction) imports
 * nothing: duplicating the conversation would be worse than missing a stretch of it.
 */
export function planTerminalImport(
  entries: readonly LogEntry[],
  saved: readonly SavedMessage[],
): NewLogEntry[] {
  const promptIds = new Set<string>();
  const known = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "prompt") promptIds.add(entry.id);
    else if (entry.kind === "sdk" && typeof entry.message.uuid === "string") {
      known.add(entry.message.uuid);
    }
  }
  for (const id of promptIds) known.add(id);

  let start = 0;
  let firstLabel = IN_THE_TERMINAL;
  let summary = false;
  const anchor = saved.findLastIndex((message) => known.has(message.uuid));
  if (anchor >= 0) {
    start = anchor + 1;
    const anchored = saved[anchor];
    if (anchored && promptIds.has(anchored.uuid) && startsATurn(anchored)) {
      while (start < saved.length && !startsATurn(saved[start] as SavedMessage)) start++;
    }
  } else if (known.size > 0) {
    // The SDK gives a system message no more than its type, so a chain that begins with one is
    // told as compacted: a compaction writes its `compact_boundary` as the chain's first message.
    if (saved[0]?.type !== "system") return [];
    start = 1;
    firstLabel = COMPACTED_IN_THE_TERMINAL;
    summary = true;
  }

  const turns: NewLogEntry[] = [];
  for (const message of saved.slice(start)) {
    if (message.type === "system" || known.has(message.uuid)) continue;
    // The summary is the first thing the chain holds after the boundary.
    turns.push(asEntry(message, { summary: summary && turns.length === 0 }));
  }
  if (turns.length === 0) return [];
  return [
    { kind: "divider", label: firstLabel },
    ...turns,
    { kind: "divider", label: BACK_IN_WEB },
  ];
}
