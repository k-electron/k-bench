import type { Locator } from "@playwright/test";
import { type AppPage, expect, type Kbench, test } from "./harness.ts";

// These run on the `iphone` project: WebKit with an iPhone's settings, the one place Smart
// typing is offered. Playwright cannot drive the real iOS keyboard, so a test makes the
// keyboard's edits itself, on the terminal's hidden field: it selects a range there and runs
// an editing command over it, which raises the real beforeinput and input events.

/** A Session whose terminal runs `cat -vet`, and what the tests need to type into it. */
interface CatSession {
  terminal: Locator;
  /** The terminal's hidden field: what the on-screen keyboard types into. */
  field: Locator;
}

/**
 * Opens a shell Session and runs `cat -vet` in it. `cat -vet` prints the control characters
 * it receives in readable form (`^M` for Enter, `^?` for Backspace, `^C`, `$` at a line
 * break). The terminal is put in raw mode first so that nothing between the program and the
 * keyboard (the line discipline's erase, its Enter translation, its echo) changes what
 * arrives. Each test keeps what it sends short: a long line would wrap in the narrow
 * terminal and split what the test looks for.
 */
async function openCat(
  app: AppPage,
  kbench: Kbench,
  options: { bracketedPaste?: boolean } = {},
): Promise<CatSession> {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");
  // The shell turns bracketed paste off while a command runs, so the program asks for it.
  const askForBracketedPaste = options.bracketedPaste ? "printf '\\e[?2004h'; " : "";
  await app.runCommand(
    terminal,
    `${askForBracketedPaste}stty raw -echo opost onlcr; echo cat-$((6*7)); cat -vet`,
    "cat-42",
  );
  const field = terminal.getByRole("textbox", { name: "Terminal input" });
  await field.focus();
  return { terminal, field };
}

/** What a freshly cleared field holds: only the invisible filler (U+200B) Smart typing puts before the caret. */
const FRESH = /^\u200b*$/;

/** What the field holds after `typed` was typed into a freshly cleared one. */
function afterTyping(typed: string): RegExp {
  return new RegExp(`^\\u200b*${typed}$`);
}

/**
 * What the keyboard does to the field: replaces the text between `start` and `end` with
 * `text` (inserting when they are equal, deleting when `text` is empty). The range is
 * counted in the text typed since the field was cleared, that is after the filler, and the
 * field must be the one with focus.
 */
async function keyboardEdit(
  app: AppPage,
  start: number,
  end: number,
  text: string,
): Promise<void> {
  // The tests' TypeScript has no DOM types, so the page code is a string.
  await app.page.evaluate(`((start, end, replacement) => {
    const field = document.activeElement;
    const filler = field.value.length - field.value.replace(/^\\u200b+/, "").length;
    field.setSelectionRange(filler + start, filler + end);
    document.execCommand(replacement === "" ? "delete" : "insertText", false, replacement);
  })(${start}, ${end}, ${JSON.stringify(text)})`);
}

test("typed text reaches the Session, and an edit to an earlier word arrives as Backspaces and text", async ({
  app,
  kbench,
}) => {
  const { terminal } = await openCat(app, kbench);

  await app.page.keyboard.type("teh cat");
  await expect(terminal).toContainText("teh cat");
  // The keyboard corrects the first word, away from the end of what was typed.
  await keyboardEdit(app, 0, 3, "the");

  // Back to the first letter that differs (six characters), then the rest of the line.
  await expect(terminal).toContainText("teh cat^?^?^?^?^?^?he cat");
});

test("a double-space period arrives as a period and a space", async ({ app, kbench }) => {
  const { terminal } = await openCat(app, kbench);

  await app.page.keyboard.type("hi ");
  // The keyboard turns the second space into a period and a space.
  await keyboardEdit(app, 2, 3, ". ");
  await app.page.keyboard.type("x");

  await expect(terminal).toContainText("hi ^?. x");
});

test("the keyboard's typographic characters arrive as plain ASCII", async ({
  app,
  kbench,
}) => {
  const { terminal } = await openCat(app, kbench);

  await keyboardEdit(app, 0, 0, "‘ ’ “ ” — – … ");
  await app.page.keyboard.type("z");

  // Each has a plain equivalent, and the non-breaking space is a space.
  await expect(terminal).toContainText(`' ' " " -- - ... z`);
});

test("Backspace deletes once in the typed text and still reaches the program from an empty field", async ({
  app,
  kbench,
}) => {
  const { terminal } = await openCat(app, kbench);

  await app.page.keyboard.type("ab");
  await app.page.keyboard.press("Backspace");
  await app.page.keyboard.type("c");
  await expect(terminal).toContainText("ab^?c");

  // The Backspace after Enter has nothing in the field to delete.
  await app.page.keyboard.press("Enter");
  await app.page.keyboard.press("Backspace");
  await app.page.keyboard.type("d");
  await expect(terminal).toContainText("ab^?c^M^?d");
});

test("a key that isn't text goes to the program and empties the field, from a hardware keyboard", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  for (const [letter, key, shown] of [
    ["A", "Enter", "^M"],
    ["B", "Tab", "^I"],
    ["C", "Escape", "^["],
    ["D", "ArrowUp", "^[[A"],
    ["E", "Control+KeyU", "^U"],
  ] as const) {
    await app.page.keyboard.type(letter);
    await app.page.keyboard.press(key);
    await expect(terminal).toContainText(`${letter}${shown}`);
    await expect(field).toHaveValue(FRESH);
  }
});

test("every Extra key empties the field and still reaches the program", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  for (const [letter, key, shown] of [
    ["A", "Esc", "^["],
    ["B", "Tab", "^I"],
    ["C", "Shift Tab", "^[[Z"],
    ["D", "Up", "^[[A"],
    ["E", "Left", "^[[D"],
    ["F", "Enter", "^M"],
  ] as const) {
    await app.page.keyboard.type(letter);
    await app.extraKey(key).tap();
    await expect(terminal).toContainText(`${letter}${shown}`);
    await expect(field).toHaveValue(FRESH);
  }
  // Arming Ctrl ends the line too.
  await app.page.keyboard.type("G");
  await app.extraKey("Ctrl").tap();
  await expect(field).toHaveValue(FRESH);
});

test("every key in the overlay shown while the keyboard is up empties the field", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);
  const viewport = app.page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  await app.page.setViewportSize({
    width: viewport.width,
    height: viewport.height - 300,
  });
  await expect(app.overlayKey("Enter")).toBeVisible();

  for (const [letter, key, shown] of [
    ["A", "Esc", "^["],
    ["B", "Tab", "^I"],
    ["C", "Enter", "^M"],
    ["D", "Up", "^[[A"],
  ] as const) {
    await app.page.keyboard.type(letter);
    await app.overlayKey(key).tap();
    await expect(terminal).toContainText(`${letter}${shown}`);
    await expect(field).toHaveValue(FRESH);
  }
});

test("the field is emptied when the keyboard closes, and program output does not empty it", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  await app.page.keyboard.type("ab");
  // cat has printed what was typed: the program's output arrived, and the field kept its text.
  await expect(terminal).toContainText("ab");
  await expect(field).toHaveValue(afterTyping("ab"));

  await field.blur();
  await expect(field).toHaveValue(FRESH);
  // The next line starts afresh: nothing of the old one is deleted.
  await field.focus();
  await app.page.keyboard.type("c");
  await expect(terminal).toContainText("abc");
});

test("the field is emptied when the terminal reconnects", async ({ app, kbench }) => {
  const { terminal, field } = await openCat(app, kbench);
  await app.page.keyboard.type("ab");
  await expect(field).toHaveValue(afterTyping("ab"));

  const reconnected = app.page.waitForEvent("websocket", (ws) =>
    ws.url().includes("/terminal"),
  );
  await kbench.stopServer();
  await kbench.startServer();
  await (await reconnected).waitForEvent("framesent");

  await expect(field).toHaveValue(FRESH);
  await app.page.keyboard.type("c");
  await expect(terminal).toContainText("abc");
});

test("Return with a pending correction sends the correction, then Enter, and no line feed", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  await app.page.keyboard.type("teh");
  // iOS sends the Enter keydown, then applies the correction, then reports the line break.
  await app.page.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }))`);
  await keyboardEdit(app, 0, 3, "the");
  await app.page.evaluate(`document.execCommand("insertLineBreak")`);

  await expect(terminal).toContainText("teh^?^?he^M");
  await expect(field).toHaveValue(FRESH);
  // cat -e would show a line feed as $.
  await expect(terminal).not.toContainText("he$");
  await expect(terminal).not.toContainText("^M$");
});

test("a paste goes through the terminal's paste, bracketed when the program asked for it", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench, { bracketedPaste: true });

  await app.page.keyboard.type("ab");
  // The browser fires paste, and when that isn't cancelled it also puts the text in the
  // field and reports an input event for it.
  await app.page.evaluate(`(() => {
    const field = document.activeElement;
    const data = new DataTransfer();
    data.setData("text/plain", "one\\ntwo");
    field.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    field.value = "one\\ntwo";
    field.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
  })()`);

  // The pasted lines are not typed one by one, and a newline in them is a carriage return.
  await expect(terminal).toContainText("ab^[[200~one^Mtwo^[[201~");
  await expect(field).toHaveValue(FRESH);
});

test("a letter typed with Ctrl armed arrives as that Ctrl key", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  await app.page.keyboard.type("a");
  const ctrl = app.extraKey("Ctrl");
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
  await app.page.keyboard.type("c");

  await expect(terminal).toContainText("a^C");
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");
  await expect(field).toHaveValue(FRESH);
});

test("the hidden field's keyboard settings depend on the kind of Session", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const shellField = app
    .terminal("session 1")
    .getByRole("textbox", { name: "Terminal input" });
  // iOS reads these when the keyboard opens: they are the contract with it.
  await expect(shellField).toHaveAttribute("autocorrect", "off");
  await expect(shellField).toHaveAttribute("autocapitalize", "none");
  await expect(shellField).toHaveAttribute("spellcheck", "true");

  await app.openDrawer();
  await app.createClaudeSession("project");
  const claudeField = app
    .terminal("session 2")
    .getByRole("textbox", { name: "Terminal input" });
  await expect(claudeField).toHaveAttribute("autocorrect", "on");
  await expect(claudeField).toHaveAttribute("autocapitalize", "sentences");
  await expect(claudeField).toHaveAttribute("spellcheck", "true");
});

test("deleting past the typed text keeps deleting what the program put on the line", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");
  await app.runCommand(
    terminal,
    "touch zq-completed-name; echo made-$((6*7))",
    "made-42",
  );

  // Tab completes the name in the shell, which ends the line the keyboard knows about.
  await app.page.keyboard.type("echo zq-comp");
  await app.extraKey("Tab").tap();
  await expect(terminal).toContainText("echo zq-completed-name");

  // Each Backspace deletes one character the shell put on the line (the completed `-name`
  // and the space after it), though the keyboard has nothing of the owner's typing to delete.
  for (let deleted = 0; deleted < 6; deleted++)
    await app.page.keyboard.press("Backspace");
  await app.page.keyboard.type("x");
  // They were deleted from the field's filler, which the program counts as its own text.
  await expect(
    app.terminal("session 1").getByRole("textbox", { name: "Terminal input" }),
  ).toHaveValue(/^​{50,}x$/);
  await app.page.keyboard.press("Enter");

  // The command that ran is `echo zq-completedx`, so its output is that name alone.
  await expect(terminal).toContainText("zq-completedx");
  await expect(terminal).not.toContainText("zq-completed-namex");
});

test("the filler never reaches the Session as text", async ({ app, kbench }) => {
  const { terminal } = await openCat(app, kbench);

  await app.page.keyboard.press("Enter");
  await app.page.keyboard.type("x");
  await app.extraKey("Tab").tap();
  await app.page.keyboard.type("y");

  // `cat -v` would show a zero-width space as `M-bM-^@M-^K`.
  await expect(terminal).toContainText("^Mx^Iy");
  await expect(terminal).not.toContainText("M-");
});

test("with no text left in the field, each Backspace still reaches the program", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  // Delete all there is in the field, one character at a time.
  let pressed = 0;
  while ((await field.inputValue()) !== "") {
    await app.page.keyboard.press("Backspace");
    pressed++;
  }
  expect(pressed).toBeGreaterThan(50);
  // Nothing is left to delete, and the program still gets one Backspace per press.
  await app.page.keyboard.press("Backspace");
  await app.page.keyboard.press("Backspace");
  await app.page.keyboard.type("z");

  await expect
    .poll(async () => {
      const shown = (await terminal.textContent()) ?? "";
      return [shown.split("^?").length - 1, shown.includes("^?z")];
    })
    .toEqual([pressed + 2, true]);
});

test("a caret moved without typing goes back to the end, and typing still arrives", async ({
  app,
  kbench,
}) => {
  const { terminal, field } = await openCat(app, kbench);

  await app.page.keyboard.type("ab");
  await expect(terminal).toContainText("ab");
  // A spacebar drag moves the caret to the start of the field.
  await app.page.evaluate(`document.activeElement.setSelectionRange(0, 0)`);
  await expect
    .poll(() =>
      field.evaluate(
        (el) => (el as unknown as { selectionStart: number }).selectionStart,
      ),
    )
    .toBe((await field.inputValue()).length);
  await app.page.keyboard.type("c");

  await expect(terminal).toContainText("abc");
  // Nothing was deleted or retyped to make room for it.
  await expect(terminal).not.toContainText("^?");
});
