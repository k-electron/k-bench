import { useEffect } from "react";
import type { LogEntry } from "../../../src/shared/agent-protocol.ts";
import { api } from "../api";
import type { TranscriptItem } from "./items";
import { unsupportedKind } from "./unsupported";

/** One unsupported thing in a conversation, as the running list (#154) is told of it. */
export interface UnsupportedOccurrence {
  kind: string;
  /**
   * The same from every device that shows it, so the server counts it once: the Session, the log
   * entry (`seq`) and the kind. (Two unknown parts of one kind in one message are one occurrence.)
   */
  occurrenceId: string;
  /** When the log entry was written (ms since the epoch); undefined if it is not known. */
  at: number | undefined;
}

/** The Unsupported rows among `items`, as occurrences. Pure. */
export function unsupportedOccurrences(
  sessionId: string,
  items: readonly TranscriptItem[],
  entries: readonly LogEntry[],
): UnsupportedOccurrence[] {
  const written = new Map<number, string>();
  const found = new Map<string, UnsupportedOccurrence>();
  for (const item of items) {
    // Only an item that comes from a log entry has an identity the other devices share.
    if (item.kind !== "unsupported" || item.seq === undefined) continue;
    const kind = unsupportedKind(item);
    const occurrenceId = `${sessionId}:${item.seq}:${kind}`;
    if (found.has(occurrenceId)) continue;
    if (written.size === 0) {
      for (const entry of entries) written.set(entry.seq, entry.t);
    }
    const t = Date.parse(written.get(item.seq) ?? "");
    found.set(occurrenceId, {
      kind,
      occurrenceId,
      at: Number.isNaN(t) ? undefined : t,
    });
  }
  return [...found.values()];
}

/** What this page has already told the server (it counts each once anyway). */
const told = new Set<string>();

/**
 * Tells the server about each unsupported thing the conversation shows, once per occurrence.
 * A report the server did not take is tried again the next time the conversation changes.
 */
export function useReportUnsupported(
  sessionId: string,
  items: readonly TranscriptItem[],
  entries: readonly LogEntry[],
): void {
  useEffect(() => {
    for (const occurrence of unsupportedOccurrences(sessionId, items, entries)) {
      if (told.has(occurrence.occurrenceId)) continue;
      told.add(occurrence.occurrenceId);
      api
        .reportUnsupported({
          kind: occurrence.kind,
          sessionId,
          occurrenceId: occurrence.occurrenceId,
          ...(occurrence.at === undefined ? {} : { at: occurrence.at }),
        })
        .catch(() => told.delete(occurrence.occurrenceId));
    }
  }, [sessionId, items, entries]);
}
