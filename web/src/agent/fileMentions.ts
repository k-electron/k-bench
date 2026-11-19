/**
 * The `@` picker's rules, pure (#160). The picker is open while the caret is in a word that
 * starts with `@`, the `@` being at the start of the text or after whitespace: `@`, `@src/ap`.
 * An `@` inside a word (`you@example.com`) is never a mention. Once the word ends (a space is
 * typed after it) the picker is gone, so what is typed passes through as it is.
 */
export interface FileMention {
  /** Where the `@` is in the text. */
  start: number;
  /** Where the word ends: the caret's word, past the caret if the caret is inside it. */
  end: number;
  /** What follows the `@`, up to the caret: what the files are matched on. */
  query: string;
}

export function fileMention(text: string, caret: number): FileMention | undefined {
  const match = /(?:^|\s)@(\S*)$/.exec(text.slice(0, caret));
  if (!match) return undefined;
  const query = match[1] ?? "";
  const tail = /^\S*/.exec(text.slice(caret))?.[0] ?? "";
  return { start: caret - query.length - 1, end: caret + tail.length, query };
}

/**
 * How a mention spells `path`: `@path`, or `@"path"` when the path has whitespace in it. The live
 * check (#161) found that Claude Code expands the quoted spelling and neither the verbatim
 * `@my notes.md` (the mention ends at the space) nor the backslash-escaped one.
 */
export function mentionOf(path: string): string {
  return /\s/.test(path) && !path.includes('"') ? `@"${path}"` : `@${path}`;
}

/**
 * The text and caret once `path` is picked: the whole word becomes the mention and a space,
 * which also closes the picker, and the caret goes after the space.
 */
export function insertMention(
  text: string,
  mention: FileMention,
  path: string,
): { text: string; caret: number } {
  const inserted = `${mentionOf(path)} `;
  const after = text.slice(mention.end);
  // A space already follows the word: not another.
  const rest = after.startsWith(" ") ? after.slice(1) : after;
  const before = text.slice(0, mention.start);
  return { text: `${before}${inserted}${rest}`, caret: before.length + inserted.length };
}
