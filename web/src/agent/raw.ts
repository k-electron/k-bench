import type { LogEntry } from "../../../src/shared/agent-protocol.ts";

/**
 * The raw JSON of a message (#137), the fallback whenever something renders wrongly. Pure.
 *
 * What is raw for a log entry: for an `sdk` entry, **the SDK message exactly as Claude Code
 * sent it**, without the log's `seq`/`t`/`kind` wrapper (the runtime logs it unchanged, so
 * this is the original). Every other kind (`prompt`, `permission_asked`, `runtime`, ...) is
 * k-bench's own record, and its raw is the entry itself.
 */
export function rawOf(entry: LogEntry): unknown {
  return entry.kind === "sdk" ? entry.message : entry;
}

/** `rawOf(entry)` as the text shown: indented JSON. */
export function rawText(entry: LogEntry): string {
  return JSON.stringify(rawOf(entry), null, 2);
}

/** The entry with `seq`, if the conversation holds it. */
export function entryOfSeq(
  entries: readonly LogEntry[],
  seq: number,
): LogEntry | undefined {
  return entries.find((entry) => entry.seq === seq);
}
