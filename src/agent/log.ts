/**
 * An Agent's log: every SDK message the runtime saw, unchanged, plus the entries k-bench
 * adds (prompts, asks, runtime events). One JSON entry per line, numbered from 1 with no
 * gaps, appended and never rewritten. A restarted runtime opens the same file and carries
 * on the numbering. The runtime appends; the server reads it directly while the Agent is
 * Stopped, with the same code, so both show the same history (ADR-0008).
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import {
  type LogEntry,
  type NewLogEntry,
  openPermissionAsks,
} from "../shared/agent-protocol.ts";

/**
 * The entries in a log file's text, in order. A line that is not an entry (a write cut short
 * by a crash) is skipped.
 */
function parseEntries(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (typeof entry.seq === "number") entries.push(entry);
    } catch {
      // A torn line.
    }
  }
  return entries;
}

/**
 * The `seq` at which each turn begins, in order. A turn runs from a prompt (or, for one
 * nobody sent, Claude Code's `system/init`, which opens every turn) that follows a `result`
 * or the log's start, to the next such start. The end of a turn is the one thing Claude Code
 * says for certain, so a turn never splits a tool call from its result, and a prompt sent
 * while a reply is streaming (queued, and logged then) belongs to the turn it was sent in,
 * not the one that answers it. What Claude Code says after a `result` (the Session going
 * idle, a command completing) belongs to the turn that ended; the runtime's own entries
 * stay with the turn before them, or belong to none before the first.
 */
export function turnStarts(entries: readonly LogEntry[]): number[] {
  const starts: number[] = [];
  let beginning = true;
  for (const entry of entries) {
    if (entry.kind === "sdk" && entry.message.type === "result") {
      beginning = true;
    } else if (
      beginning &&
      (entry.kind === "prompt" ||
        (entry.kind === "sdk" &&
          entry.message.type === "system" &&
          entry.message.subtype === "init"))
    ) {
      starts.push(entry.seq);
      beginning = false;
    }
  }
  return starts;
}

/**
 * Reads an Agent's log and never writes it. The server reads a Stopped Agent's log with this
 * (nothing may write to the log of an Agent that is not running); the runtime's `AgentLog`
 * is the same reading code plus the appending.
 */
export class AgentLogReader {
  protected readonly file: string;

  /** Opens the log at `file` (`agentLogFile`), which need not exist yet. */
  constructor(file: string) {
    this.file = file;
  }

  /** Every entry after `seq` (0 for all of them), in order. */
  readAfter(seq: number): LogEntry[] {
    if (!existsSync(this.file)) return [];
    return parseEntries(readFileSync(this.file, "utf8")).filter((e) => e.seq > seq);
  }

  /**
   * What a client that holds nothing is sent to open the conversation: the last `turns`
   * turns, whole, and the permission asks still open from before them (so an open ask is
   * always known; `openPermissionAsks`). `from` is where the contiguous part begins, 1 when
   * it is the whole log; the asks, if any, come first and have a `seq` below it. Everything
   * earlier is fetched with `readPage`. The turn in flight is always whole, so a reply that
   * is mid-stream is never cut off from its start.
   */
  readTail(turns: number): { from: number; entries: LogEntry[] } {
    const all = this.readAll();
    const starts = turnStarts(all);
    const from = starts.length > turns ? (starts[starts.length - turns] ?? 1) : 1;
    const carried = openPermissionAsks(all).filter((ask) => ask.seq < from);
    return {
      from,
      entries: [...carried, ...all.filter((entry) => entry.seq >= from)],
    };
  }

  /**
   * The `turns` turns that precede `beforeSeq`, whole, as `{from, entries}`: the entries with
   * a `seq` from `from` up to but not including `beforeSeq`, which is 1 once the page reaches
   * the log's start. Paging back from `readTail`'s `from`, each page's `from` is the next
   * one's `beforeSeq`, so the pages meet with no gap and no repeat.
   */
  readPage(beforeSeq: number, turns: number): { from: number; entries: LogEntry[] } {
    const all = this.readAll();
    const starts = turnStarts(all).filter((seq) => seq < beforeSeq);
    const from = starts.length > turns ? (starts[starts.length - turns] ?? 1) : 1;
    return {
      from,
      entries: all.filter((entry) => entry.seq >= from && entry.seq < beforeSeq),
    };
  }

  protected readAll(): LogEntry[] {
    return existsSync(this.file) ? parseEntries(readFileSync(this.file, "utf8")) : [];
  }

  /** Whether any prompt was ever sent: Claude Code saves a conversation only after its first message. */
  hasPrompt(): boolean {
    return this.readAfter(0).some((entry) => entry.kind === "prompt");
  }
}

/** The log as the runtime holds it: everything `AgentLogReader` reads, and `append`. */
export class AgentLog extends AgentLogReader {
  private lastSeq: number;

  /** Opens the log at `file` (`agentLogFile`), which need not exist yet. */
  constructor(file: string) {
    super(file);
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    this.lastSeq = parseEntries(text).at(-1)?.seq ?? 0;
    // A write cut short by a crash leaves no newline: start the next entry on its own line.
    if (text !== "" && !text.endsWith("\n")) appendFileSync(file, "\n");
  }

  /** The `seq` of the newest entry, 0 for an empty log. */
  get last(): number {
    return this.lastSeq;
  }

  /** Numbers and stamps `entry`, writes it and returns it as written. */
  append(entry: NewLogEntry): LogEntry {
    const written = {
      ...entry,
      seq: this.lastSeq + 1,
      t: new Date().toISOString(),
    } as LogEntry;
    appendFileSync(this.file, `${JSON.stringify(written)}\n`);
    this.lastSeq = written.seq;
    return written;
  }
}
