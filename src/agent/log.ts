/**
 * An Agent's log: every SDK message the runtime saw, unchanged, plus the entries k-bench
 * adds (prompts, asks, runtime events). One JSON entry per line, numbered from 1 with no
 * gaps, appended and never rewritten. A restarted runtime opens the same file and carries
 * on the numbering. The runtime appends; the server reads it directly while the Agent is
 * Stopped, with the same code, so both show the same history (ADR-0008).
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { LogEntry, NewLogEntry } from "../shared/agent-protocol.ts";

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

export class AgentLog {
  private readonly file: string;
  private lastSeq: number;

  /** Opens the log at `file` (`agentLogFile`), which need not exist yet. */
  constructor(file: string) {
    this.file = file;
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

  /** Every entry after `seq` (0 for all of them), in order. */
  readAfter(seq: number): LogEntry[] {
    if (!existsSync(this.file)) return [];
    return parseEntries(readFileSync(this.file, "utf8")).filter((e) => e.seq > seq);
  }

  /** Whether any prompt was ever sent: Claude Code saves a conversation only after its first message. */
  hasPrompt(): boolean {
    return this.readAfter(0).some((entry) => entry.kind === "prompt");
  }
}
