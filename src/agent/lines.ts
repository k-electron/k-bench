/**
 * Newline-delimited framing for the runtime's unix socket: every message is one line of
 * JSON. Shared by the runtime (which listens), the server (which relays and reads status)
 * and the test client.
 */

/** The longest line accepted. A longer one is a broken or hostile peer: the caller hangs up. */
export const MAX_LINE_CHARACTERS = 16 * 1024 * 1024;

/**
 * Splits a stream of text chunks into lines. Feed it chunks; it returns the lines they
 * completed, without their newlines, and keeps the rest for the next chunk.
 * `overflowed` turns true once an unfinished line is longer than `MAX_LINE_CHARACTERS`.
 */
export class LineSplitter {
  private pending = "";
  overflowed = false;

  push(chunk: string): string[] {
    this.pending += chunk;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    if (this.pending.length > MAX_LINE_CHARACTERS) this.overflowed = true;
    return lines.filter((line) => line !== "");
  }
}
