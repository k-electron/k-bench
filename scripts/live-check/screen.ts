// Reading a Claude TUI's screen, as pure functions of its text, so that what the live check
// presses a key for can be tested. The rule for every dialog: never press Enter blindly. Enter
// is sent only while the cursor (`❯`) is on the option the check chose by its text, because a
// dialog's default can be the destructive one (the folder-trust question's default is
// "No, exit", which quits the terminal).

/** The text after the last place `marker` matches, or "" when it does not match. */
export function afterLast(text: string, marker: RegExp): string {
  let end = -1;
  for (const found of text.matchAll(new RegExp(marker.source, `${marker.flags}g`))) {
    end = (found.index ?? 0) + found[0].length;
  }
  return end < 0 ? "" : text.slice(end);
}

/** The line the menu cursor (`❯`) is on: the lowest one on the screen. */
export function cursorLine(pane: string): string {
  return (
    pane
      .split("\n")
      .filter((line) => /^\s*❯/.test(line))
      .at(-1) ?? ""
  );
}

/** The footer, where the permission mode is named: the screen's last lines. */
export function footerOf(pane: string): string {
  return pane
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-4)
    .join("\n");
}

/** A menu is open: text only a menu has, on a line that is not the command typed to open it. */
export function menuShown(pane: string, menu: RegExp): boolean {
  return pane.split("\n").some((line) => menu.test(line) && !/\/rewind/.test(line));
}

export const TRUST_QUESTION = /trust the files|Do you trust|trust this folder/i;
const TRUST_YES = /Yes, I trust|Yes, proceed/;

export type Key = "Enter" | "Down" | "none";

/**
 * What to press on the folder-trust question: Enter only while the cursor is on "Yes, I trust
 * this folder" (the default is "No, exit", which quits the terminal), Down while it is on
 * anything else, nothing when the question is not on the screen or the cursor is not seen.
 */
export function trustKey(pane: string): Key {
  if (!TRUST_QUESTION.test(pane)) return "none";
  const cursor = cursorLine(pane);
  if (TRUST_YES.test(cursor)) return "Enter";
  return cursor === "" ? "none" : "Down";
}

/** Keys the dialog logic asks for; `type` is the reply text, typed (not a key). */
export type DialogKey = "Enter" | "Down" | "Up" | "Tab" | "type" | "none";

/**
 * The write-permission dialog as the real TUI (claude 2.1.328) draws it:
 *
 *      Do you want to overwrite story.txt?
 *      ❯ 1. Yes
 *        2. Yes, and switch to accept edits (auto-approve file edits ...) for this session (shift+tab)
 *        3. No
 *      Esc to cancel · Tab to amend
 *
 * The cursor starts on option 1. Tab on `3. No` turns that row into `3. No, and tell Claude what
 * to do differently`, and the footer loses `· Tab to amend`; text typed then shows in the row as
 * `3. No, <text>`, and Enter sends it.
 */
export function dialogFor(pane: string, file: string): boolean {
  const asked = afterLast(pane, /Do you want to/i);
  return asked !== "" && asked.includes(file);
}

/**
 * What to press next on that dialog, from the screen alone, one step at a time (each step is
 * looked at again before the next):
 * - `allow`: Enter only while the cursor is on exactly `1. Yes`, Up from anywhere else; never
 *   option 2, which switches the session to accept edits.
 * - `reply`: Down to `3. No`, Tab there, then, once the row reads `tell Claude what to do
 *   differently`, `type` the reply, and Enter once the row shows it.
 */
export function permissionKey(
  pane: string,
  want: "allow" | "reply",
  feedback = "",
): DialogKey {
  const cursor = cursorLine(pane);
  if (cursor === "") return "none";
  const option = /^\s*❯\s*(\d)\.\s*(.*?)\s*$/.exec(cursor);
  if (!option) return "none";
  const [, number, text = ""] = option;
  if (want === "allow") return number === "1" && text === "Yes" ? "Enter" : "Up";
  if (number !== "3") return "Down";
  if (feedback !== "" && text.includes(feedback)) return "Enter";
  if (/tell Claude what to do differently/i.test(text)) return "type";
  return text === "No" ? "Tab" : "none";
}
