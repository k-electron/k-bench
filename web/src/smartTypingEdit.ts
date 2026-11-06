/**
 * The comparison behind Smart typing (ADR 0006), with no DOM and no xterm.js: what the
 * Session's program has to be sent for the keyboard's change to the typed text.
 */

/** The keyboard's typographic characters, as the plain ASCII a terminal wants. */
const PLAIN: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "—": "--",
  "–": "-",
  "…": "...",
  " ": " ",
};

const TYPOGRAPHIC = /[‘’“”—–… ]/g;

/** `text` with the keyboard's typographic characters turned into plain ASCII. */
export function plain(text: string): string {
  return text.replace(TYPOGRAPHIC, (c) => PLAIN[c] ?? c);
}

/**
 * The edit that turns `before` into `after`, as the program sees it: Backspaces from the
 * end back to the first character that differs, then the new text from there. Both texts
 * are compared as plain ASCII, so the program is sent exactly what it was sent before.
 * Characters are counted as the program counts them, an emoji being one.
 */
export function sessionEdit(
  before: string,
  after: string,
): { backspaces: number; text: string } {
  const a = Array.from(plain(before));
  const b = Array.from(plain(after));
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same++;
  return { backspaces: a.length - same, text: b.slice(same).join("") };
}
