import type { Locator } from "@playwright/test";
import { expect, test } from "./harness.ts";

/** Where, in CSS pixels from the viewport's left edge, `text` is drawn inside `terminal`. */
async function drawnLeft(terminal: Locator, text: string): Promise<number> {
  return terminal.evaluate((root, wanted) => {
    // Through `root.ownerDocument`: the page's DOM globals are not typed in this project.
    const doc = root.ownerDocument;
    const textNodes = doc.createTreeWalker(root, 4); // 4 is NodeFilter.SHOW_TEXT
    for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
      const at = (node.textContent ?? "").indexOf(wanted);
      if (at < 0) continue;
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      return range.getBoundingClientRect().left;
    }
    throw new Error(`${wanted} is not drawn in the terminal`);
  }, text);
}

test("text after a joined emoji is drawn where tmux puts it", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");

  // tmux counts the joined emoji family (man, woman, child) as 2 columns, so it draws the
  // second line's marker, indented by 2 spaces, in the same column as the first line's. The
  // emoji is written as octal bytes and each marker is split by an empty quote, so the typed
  // command never contains either of them: only what the shell prints does.
  const family =
    "\\360\\237\\221\\250\\342\\200\\215\\360\\237\\221\\251\\342\\200\\215\\360\\237\\221\\247";
  await app.runCommand(
    terminal,
    `printf '${family}%s\\n  %s\\n' first-mar''ker second-mar''ker`,
    "second-marker",
  );

  const first = await drawnLeft(terminal, "first-marker");
  const second = await drawnLeft(terminal, "second-marker");
  expect(first).toBeCloseTo(second, 0);
});
