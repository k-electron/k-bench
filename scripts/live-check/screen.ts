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

/**
 * What to press on a permission dialog to choose an option by its text: `allow` is plain
 * "Yes" (not "allow all edits" or "don't ask again"), `reply` is "No, and tell Claude what to
 * do differently". Enter is only for `allow` while the cursor is on it; `reply` is typed into
 * once the cursor is on it, so it is reported as `type`.
 */
export function permissionKey(
  pane: string,
  want: "allow" | "reply",
): "Enter" | "Down" | "type" | "none" {
  const cursor = cursorLine(pane);
  if (cursor === "") return "none";
  if (want === "reply") return /tell Claude/i.test(cursor) ? "type" : "Down";
  return /Yes/.test(cursor) && !/allow all|don't ask|always|session/i.test(cursor)
    ? "Enter"
    : "Down";
}
