/**
 * The comparison behind Smart typing (ADR 0006), with no DOM and no xterm.js: what the
 * Session's program has to be sent for the keyboard's change to the typed text.
 */

/**
 * The invisible character (zero-width space) the field is filled with before the caret. It
 * counts as text already in the program, so deleting one is a Backspace, but it is never
 * sent as text.
 */
export const FILLER_CHAR = "\u200b";

/** The keyboard's typographic characters, as the plain ASCII a terminal wants. */
const PLAIN: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "—": "--",
  "–": "-",
  "…": "...",
  "\u00a0": " ",
};

const TYPOGRAPHIC = /[‘’“”—–…\u00a0]/g;

/** `text` with the keyboard's typographic characters turned into plain ASCII. */
function toPlainAscii(text: string): string {
  return text.replace(TYPOGRAPHIC, (c) => PLAIN[c] ?? c);
}

/**
 * The edit that turns `before` into `after`, as the program sees it: Backspaces from the
 * end back to the first character that differs, then the new text from there. Both texts
 * are compared as plain ASCII, so the program is sent exactly what it was sent before.
 * Characters are counted as the program counts them, an emoji being one, and each filler
 * character deleted is a Backspace. The filler is never in the new text; when the change
 * left some of it after the first difference (a replacement that started inside it),
 * `fillerLeft` says the field no longer matches the program's line.
 */
export function sessionEdit(
  before: string,
  after: string,
): { backspaces: number; text: string; fillerLeft: boolean } {
  const a = Array.from(toPlainAscii(before));
  const b = Array.from(toPlainAscii(after));
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same++;
  const added = b.slice(same);
  const text = added.filter((c) => c !== FILLER_CHAR);
  return {
    backspaces: a.length - same,
    text: text.join(""),
    fillerLeft: text.length !== added.length,
  };
}
