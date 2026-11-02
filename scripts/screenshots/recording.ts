// A terminal recording: what a program printed, and when, so it can be played back into a
// Session later. Used for the README's hero image (real Claude Code running in a Pane).
//
// The file is JSON, small enough to review by eye. `events` holds [milliseconds since the
// start, the text the program printed] pairs; the text is UTF-8 decoded with escape
// sequences left in, so a reviewer can grep a recording for anything private before
// committing it.
import { readFileSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export interface Recording {
  format: "k-bench-recording";
  version: 1;
  /** Free text saying what was recorded. A placeholder says so here. */
  note: string;
  /** The terminal size the program drew for. Playback needs a terminal of exactly this size. */
  cols: number;
  rows: number;
  events: Array<[number, string]>;
}

export function readRecording(path: string): Recording {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Recording;
  if (parsed.format !== "k-bench-recording" || parsed.version !== 1) {
    throw new Error(`${path} is not a k-bench recording (version 1)`);
  }
  return parsed;
}

export function writeRecording(path: string, recording: Recording): void {
  // One event per line: diff- and grep-friendly.
  const head = JSON.stringify({ ...recording, events: undefined }).slice(0, -1);
  const events = recording.events.map((event) => `  ${JSON.stringify(event)}`);
  writeFileSync(path, `${head},"events":[\n${events.join(",\n")}\n]}\n`);
}

/** Builds a recording from output chunks as a pty delivers them, keeping characters whole. */
export class RecordingBuilder {
  private readonly decoder = new StringDecoder("utf8");
  private readonly started = Date.now();
  private readonly events: Array<[number, string]> = [];
  private readonly header: Pick<Recording, "note" | "cols" | "rows">;

  constructor(header: Pick<Recording, "note" | "cols" | "rows">) {
    this.header = header;
  }

  add(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (text !== "") this.events.push([Date.now() - this.started, text]);
  }

  build(): Recording {
    const rest = this.decoder.end();
    if (rest !== "") this.events.push([Date.now() - this.started, rest]);
    return {
      format: "k-bench-recording",
      version: 1,
      ...this.header,
      events: this.events,
    };
  }
}

/** One private string and what to show instead. */
export interface Replacement {
  from: string;
  to: string;
}

/**
 * Parses `from=>to` pairs. `to` is padded with spaces to the width of `from`, so text laid
 * out in columns (a banner box) keeps its shape; a longer `to` is refused.
 */
export function parseReplacement(pair: string): Replacement {
  const at = pair.indexOf("=>");
  if (at <= 0)
    throw new Error(`A replacement looks like "private=>public", got "${pair}"`);
  const from = pair.slice(0, at);
  const to = pair.slice(at + 2);
  if (to.length > from.length) {
    throw new Error(
      `The replacement for a ${from.length}-character string is ${to.length} characters; ` +
        "it may not be longer, or the terminal layout shifts",
    );
  }
  return { from, to: to.padEnd(from.length, " ") };
}

/**
 * Rewrites every private string across the whole stream, not chunk by chunk, so one split
 * over two chunks is still found. Replacements keep their width, so the chunks (and their
 * timing) stay exactly as they were.
 */
export function scrub(recording: Recording, replacements: Replacement[]): Recording {
  const sizes = recording.events.map(([, text]) => text.length);
  // Longest first, so a string that contains another is not half-replaced.
  const ordered = [...replacements].sort((a, b) => b.from.length - a.from.length);
  let stream = recording.events.map(([, text]) => text).join("");
  for (const { from, to } of ordered) stream = stream.split(from).join(to);
  let offset = 0;
  const events = recording.events.map(([ms], index): [number, string] => {
    const size = sizes[index] ?? 0;
    const text = stream.slice(offset, offset + size);
    offset += size;
    return [ms, text];
  });
  return { ...recording, events };
}

const ANSI =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9]|[=>78])/g;

/** The recording's text with escape sequences removed: what a text search would see. */
export function plainText(recording: Recording): string {
  return recording.events
    .map(([, text]) => text)
    .join("")
    .replace(ANSI, "");
}
