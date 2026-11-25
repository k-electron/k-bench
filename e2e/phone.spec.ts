import { rmSync } from "node:fs";
import { type AppPage, expect, type Kbench, test } from "./harness.ts";

// These run on the `phone` project: a touch device narrower than the layout breakpoint.

test("on load the phone shows the Open Workspace's Prime, titled Workspace › Prime", async ({
  app,
  kbench,
  page,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.openDrawer();
  await app.createWorkspace(folder, { name: "alpha" });

  // Loading k-bench opens the Open Workspace, starting its Prime.
  await page.reload();
  await expect(app.terminal("Prime")).toContainText(`claude-stub cwd: ${folder}`);
  await expect(app.terminal("Prime")).toContainText("claude-stub ready");
  await expect(app.terminal("Worker")).toHaveCount(0);
  await expect(app.phoneTitle).toHaveText("alpha › Prime");
  const menu = await page
    .getByRole("button", { name: "Menu", exact: true })
    .boundingBox();
  const title = await app.phoneTitle.boundingBox();
  if (!menu || !title) throw new Error("The Menu button and the title should both show");
  expect(title.x).toBeGreaterThanOrEqual(menu.x + menu.width);
});

test("a long Workspace name is cut off in the title before the Session's name", async ({
  app,
  kbench,
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await app.openDrawer();
  const name = "a-workspace-whose-name-is-far-too-long-for-a-phone";
  await app.createWorkspace(kbench.instance.makeFolder("project"), { name });
  await app.createSession(name);
  await expect(app.terminal("session 1")).toBeVisible();

  await expect(app.phoneTitle).toHaveText(`${name} › session 1`);
  const session = app.phoneTitle.getByText("session 1", { exact: true });
  const workspace = app.phoneTitle.getByText(name, { exact: true });
  // The Session's name shows in full, inside the screen; the Workspace's is clipped.
  expect(await session.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const box = await session.boundingBox();
  if (!box) throw new Error("The Session's name should show");
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await workspace.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test("tapping a Workspace's name in the drawer opens it on its Prime and closes the drawer", async ({
  app,
  kbench,
  page,
}) => {
  const two = kbench.instance.makeFolder("two");
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(two, { name: "beta" });
  await page.reload();
  await expect(app.phoneTitle).toHaveText("alpha › Prime");
  const openByName = async (name: string) => {
    await app.openDrawer();
    await app.workspace(name).getByRole("button", { name, exact: true }).tap();
    await expect(app.drawer).toBeHidden();
  };

  await openByName("beta");

  await expect(app.phoneTitle).toHaveText("beta › Prime");
  await expect(app.terminal("Prime")).toContainText(`claude-stub cwd: ${two}`);
  // Even after showing its Worker, the Workspace's name brings back its Prime.
  await app.openDrawer();
  await app.session("Worker").tap();
  await expect(app.phoneTitle).toHaveText("beta › Worker");
  await openByName("alpha");
  await expect(app.phoneTitle).toHaveText("alpha › Prime");
  await openByName("beta");
  await expect(app.phoneTitle).toHaveText("beta › Prime");
  await expect(app.terminal("Prime")).toContainText(`claude-stub cwd: ${two}`);
});

test("tapping the title lists the Workspace's Sessions, and tapping one shows it and closes the sheet", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"), { name: "alpha" });
  await app.createSession("alpha");
  await expect(app.terminal("session 1")).toBeVisible();

  await app.openSessionsSheet();

  // Prime, Worker, then the Other Sessions; the one on screen is highlighted.
  await expect(app.sessionsSheet.getByRole("listitem")).toHaveText([
    /^Prime/,
    /^Worker/,
    /^session 1/,
  ]);
  await expect(app.sheetRow("Worker")).toContainText("stopped");
  await expect(app.sheetRow("session 1")).toHaveAttribute("aria-current", "true");
  await expect(app.sheetRow("Prime")).not.toHaveAttribute("aria-current", "true");

  await app.sheetRow("Worker").tap();

  await expect(app.sessionsSheet).toBeHidden();
  await expect(app.phoneTitle).toHaveText("alpha › Worker");
  await expect(app.terminal("session 1")).toHaveCount(0);

  // Tapping outside the sheet closes it without choosing.
  await app.openSessionsSheet();
  await app.sessionsSheet.getByRole("button", { name: "Close sessions" }).tap();
  await expect(app.sessionsSheet).toBeHidden();
  await expect(app.phoneTitle).toHaveText("alpha › Worker");
});

test("a Bell elsewhere in the Open Workspace dots its name in the title, and one in another Workspace dots the menu button", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  await app.createSession("beta");
  await expect(app.terminal("session 1")).toBeVisible();
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  // Opening alpha starts its Prime and Worker, and shows the Prime.
  await app.workspace("alpha").getByRole("button", { name: "alpha", exact: true }).tap();
  await expect(app.terminal("Prime")).toContainText("claude-stub ready");
  await expect(app.titleBell).toHaveCount(0);
  await expect(app.menuBell).toHaveCount(0);

  await kbench.ringBell("Worker", "alpha");

  await expect(app.titleBell).toBeVisible();
  await expect(app.menuBell).toHaveCount(0);

  await kbench.ringBell("session 1", "beta");

  await expect(app.menuBell).toBeVisible();
  await expect(app.titleBell).toBeVisible();
});

test("a Stopped Session on screen shows Restart, and pressing it brings the terminal back", async ({
  app,
  kbench,
  page,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await page.keyboard.press("Escape");
  await expect(app.drawer).toBeHidden();

  // A new Workspace's Prime isn't started until the Workspace is opened.
  await expect(app.phoneTitle).toHaveText("project › Prime");
  const restart = page.getByRole("button", { name: "Restart", exact: true });
  await restart.tap();

  await expect(restart).toHaveCount(0);
  await expect(app.terminal("Prime")).toContainText("claude-stub ready");
});

test("a Missing Workspace on the phone says its folder is missing, and Change folder there fixes it", async ({
  app,
  kbench,
  page,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.openDrawer();
  await app.createWorkspace(folder);
  rmSync(folder, { recursive: true });
  await page.reload();

  const main = page.getByRole("main");
  await expect(main).toContainText("This Workspace's folder is missing");
  await expect(main.getByRole("button", { name: "Restart" })).toHaveCount(0);
  await main.getByRole("button", { name: "Change folder", exact: true }).tap();
  const restored = kbench.instance.makeFolder("restored");
  await app.pickFolder(restored);
  await page.getByRole("button", { name: "Save" }).tap();

  await expect(app.terminal("Prime")).toContainText(`claude-stub cwd: ${restored}`);
});

test("the drawer opens from the menu button;tapping a Session opens it and closes the drawer", async ({
  app,
  kbench,
}) => {
  await expect(app.drawer).toBeHidden();
  await app.openDrawer();
  await expect(app.drawer).toBeVisible();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminal("session 1")).toBeVisible();
  await app.openDrawer();
  await app.createSession("project");
  await expect(app.terminal("session 2")).toBeVisible();
  // Opening a Session closes the drawer, so the terminal has the whole screen.
  await expect(app.drawer).toBeHidden();

  await app.openDrawer();
  await app.session("session 1").tap();
  await expect(app.terminal("session 1")).toBeVisible();
  await expect(app.terminal("session 2")).toHaveCount(0);
  await expect(app.drawer).toBeHidden();
});

test("the extra keys reach the shell", async ({ app, kbench }) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  // `cat -vt` prints the control sequences it receives in readable form (^[ is Esc).
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("cat -vt");
  await app.page.keyboard.press("Enter");

  // Letters between the keys keep the sequences apart and show they arrive in order.
  await app.extraKey("Esc").tap();
  await app.page.keyboard.type("A");
  await app.extraKey("Tab").tap();
  await app.page.keyboard.type("B");
  await app.extraKey("Shift Tab").tap();
  await app.page.keyboard.type("C");
  await app.page.keyboard.press("Enter");
  // A Tab only shows as ^I in cat's output, not in the terminal's own echo of the line.
  await expect(terminal).toContainText("^[A^IB^[[ZC");

  await app.extraKey("Up").tap();
  await app.page.keyboard.type("D");
  await app.extraKey("Down").tap();
  await app.page.keyboard.type("E");
  await app.extraKey("Left").tap();
  await app.page.keyboard.type("F");
  await app.extraKey("Right").tap();
  await app.page.keyboard.type("G");
  await app.page.keyboard.press("Enter");
  await expect(terminal).toContainText("^[[AD^[[BE^[[DF^[[CG");
});

test("the extra keys' Enter runs the line the owner typed", async ({ app, kbench }) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  // The shell prints 42 only when it computes the line, so the typed text can't pass for it.
  await app.page.keyboard.type("echo entered-$((6*7))");
  await app.extraKey("Enter").tap();
  await expect(terminal).toContainText("entered-42");
  // The terminal kept focus, so the on-screen keyboard would have stayed up.
  await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
});

test("the extra keys fit in one row on a 375px-wide phone, each 40px tall", async ({
  app,
  kbench,
}) => {
  await app.page.setViewportSize({ width: 375, height: 700 });
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminal("session 1")).toBeVisible();

  const row = app.page.getByRole("group", { name: "Extra keys", exact: true });
  const names = [
    "Esc",
    "Tab",
    "Shift Tab",
    "Ctrl",
    "Left",
    "Up",
    "Down",
    "Right",
    "Enter",
  ];
  for (const name of names) await expect(app.extraKey(name)).toBeVisible();
  // Smart typing is offered on an iPhone only (see `smart-typing.spec.ts`), so the row has
  // nine keys here and no switch.
  await expect(row.getByRole("button")).toHaveCount(names.length);
  await expect(app.extraKey("Smart typing")).toHaveCount(0);

  const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const rowBox = await row.boundingBox();
  if (!rowBox) throw new Error("The Extra keys row should show");
  let top: number | undefined;
  for (const name of names) {
    const box = await app.extraKey(name).boundingBox();
    if (!box) throw new Error(`${name} should show`);
    expect(box.height).toBe(40);
    // One row: every key starts at the same height.
    top ??= box.y;
    expect(box.y).toBe(top);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  }
});

test("Ctrl applies to the next key only, including keys typed on the keyboard", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("sleep 300");
  await app.page.keyboard.press("Enter");

  const ctrl = app.extraKey("Ctrl");
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
  await app.page.keyboard.type("c");
  // One-shot: it has been used up.
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");

  // The shell answers only once `sleep 300` has been interrupted.
  await app.runMarker(terminal, "interrupted");
});

test("an armed Ctrl waits for the owner's next key through a reconnect", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("sleep 300");
  await app.page.keyboard.press("Enter");
  const ctrl = app.extraKey("Ctrl");
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");

  // On every attach tmux asks the terminal about itself, and the terminal answers on its
  // own: the first thing the new socket sends is those answers, not anything the owner typed.
  const reconnected = app.page.waitForEvent("websocket", (ws) =>
    ws.url().includes("/terminal"),
  );
  await kbench.stopServer();
  await kbench.startServer();
  await (await reconnected).waitForEvent("framesent");

  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
  await app.page.keyboard.type("c");
  // The shell answers only once `sleep 300` has been interrupted.
  await app.runMarker(terminal, "interrupted");
});

test("the phone keeps showing the Session it last showed in the Workspace across a reload", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.openDrawer();
  await app.createSession("project");
  await expect(app.terminal("session 2")).toBeVisible();
  await app.openDrawer();
  await app.session("session 1").tap();
  await expect(app.terminal("session 1")).toBeVisible();

  await app.page.reload();
  await expect(app.terminal("session 1")).toBeVisible();
  await expect(app.phoneTitle).toHaveText("project › session 1");
  await expect(app.terminal("session 2")).toHaveCount(0);
  await expect(app.terminal("Prime")).toHaveCount(0);
});

test("with the on-screen keyboard up the app gives the terminal the room and compact keys replace the row", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");
  const input = terminal.getByRole("textbox", { name: "Terminal input" });
  const menu = app.page.getByRole("button", { name: "Menu", exact: true });
  const { rows: rowsBefore } = await app.terminalSize(terminal);
  await expect(menu).toBeVisible();
  await expect(app.extraKey("Ctrl")).toBeVisible();

  // The keyboard takes room from the page and the width stays the same: the height shrinks.
  const viewport = app.page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  await input.focus();
  await app.page.setViewportSize({
    width: viewport.width,
    height: viewport.height - 300,
  });

  await expect(menu).toBeHidden();
  await expect(app.extraKey("Esc")).toBeHidden();
  await expect(app.overlayKey("Enter")).toBeVisible();
  await expect
    .poll(async () => (await app.terminalSize(terminal)).rows)
    .toBeLessThan(rowsBefore);

  // The compact keys type into the Session and leave the keyboard open.
  await app.page.keyboard.type("cat -vt");
  await app.overlayKey("Enter").tap();
  await app.overlayKey("Esc").tap();
  await app.page.keyboard.type("A");
  await app.overlayKey("Tab").tap();
  await app.page.keyboard.type("B");
  await app.overlayKey("Up").tap();
  await app.page.keyboard.type("C");
  await app.overlayKey("Down").tap();
  await app.page.keyboard.type("D");
  await app.overlayKey("Left").tap();
  await app.page.keyboard.type("E");
  await app.overlayKey("Right").tap();
  await app.page.keyboard.type("F");
  await app.overlayKey("Enter").tap();
  await expect(terminal).toContainText("^[A^IB^[[AC^[[BD^[[DE^[[CF");
  await expect(input).toBeFocused();
  // Ctrl and ⇧Tab are only on the full row, with the keyboard down.
  await expect(app.overlayKey("Ctrl")).toHaveCount(0);
  await expect(app.overlayKey("Shift Tab")).toHaveCount(0);

  // Turning the phone sideways changes the width, which is not the keyboard going away.
  await app.page.setViewportSize({ width: 600, height: 300 });
  await expect(app.overlayKey("Enter")).toBeVisible();
  await expect(menu).toBeHidden();

  // Closing the keyboard brings the header and the full row back.
  await app.overlayKey("Close keyboard").tap();
  await expect(menu).toBeVisible();
  await expect(app.extraKey("Ctrl")).toBeVisible();
  await expect(app.extraKey("Shift Tab")).toBeVisible();
  await expect(app.overlayKey("Enter")).toBeHidden();
});

test("the full extra keys row comes back when the keyboard goes away by itself", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  const viewport = app.page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.setViewportSize({
    width: viewport.width,
    height: viewport.height - 300,
  });
  await expect(app.overlayKey("Enter")).toBeVisible();

  await app.page.setViewportSize(viewport);
  await expect(app.extraKey("Ctrl")).toBeVisible();
  await expect(app.overlayKey("Enter")).toBeHidden();
  await expect(app.page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
});

test("the phone launches a Claude Session from the + menu and the dialog", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  await app.openClaudeDialog("project");
  // Every option fits the phone's screen, with Launch within reach.
  await expect(app.claudeDialog.getByRole("button", { name: "Launch" })).toBeInViewport();
  await app.launchClaude({ model: "Sonnet", focusView: true });

  await expect(app.claudeDialog).toBeHidden();
  await expect(app.drawer).toBeHidden();
  await expect(app.terminal("session 1")).toContainText("claude-stub ready");
  await app.openDrawer();
  await expect(app.claudeGlyph("session 1")).toBeVisible();
});

test.describe("Paste in the keyboard-up overlay", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  /**
   * Opens a shell Session running `cat -vet` in raw mode (it prints control characters in
   * readable form), with the program having asked for bracketed paste, then puts the
   * on-screen keyboard up: the field focused and the viewport shorter.
   */
  async function openCatWithKeyboardUp(
    app: AppPage,
    kbench: Kbench,
    options: { bracketedPaste?: boolean } = { bracketedPaste: true },
  ) {
    await app.openDrawer();
    await app.createWorkspace(kbench.instance.makeFolder("project"));
    await app.createSession("project");
    const terminal = app.terminal("session 1");
    await app.runMarker(terminal, "shellready");
    // The shell turns bracketed paste off while a command runs, so the program asks for it.
    await app.runCommand(
      terminal,
      `${options.bracketedPaste ? "printf '\\e[?2004h'; " : ""}stty raw -echo opost onlcr; echo cat-$((6*7)); cat -vet`,
      "cat-42",
    );
    const input = terminal.getByRole("textbox", { name: "Terminal input" });
    await input.focus();
    const viewport = app.page.viewportSize();
    if (!viewport) throw new Error("no viewport");
    await app.page.setViewportSize({
      width: viewport.width,
      height: viewport.height - 300,
    });
    await expect(app.overlayKey("Paste")).toBeVisible();
    return { terminal, input };
  }

  test("Paste puts the clipboard into the Session as one paste and keeps the keyboard up", async ({
    app,
    kbench,
  }) => {
    const { terminal, input } = await openCatWithKeyboardUp(app, kbench);
    await app.page.evaluate('navigator.clipboard.writeText("one\\ntwo")');

    await app.overlayKey("Paste").tap();

    // Bracketed, so the two lines are not run one by one; a newline arrives as a carriage return.
    await expect(terminal).toContainText("^[[200~one^Mtwo^[[201~");
    await expect(input).toBeFocused();
  });

  test("Paste with Ctrl armed sends the character as it is and disarms Ctrl", async ({
    app,
    kbench,
  }) => {
    // A single pasted character is the one an armed Ctrl would turn into a control key.
    const { terminal, input } = await openCatWithKeyboardUp(app, kbench, {
      bracketedPaste: false,
    });
    await app.page.evaluate('navigator.clipboard.writeText("c")');
    // Ctrl is only on the full row, so arm it before the keyboard comes up.
    const viewport = app.page.viewportSize();
    if (!viewport) throw new Error("no viewport");
    await app.page.setViewportSize({
      width: viewport.width,
      height: viewport.height + 300,
    });
    await app.extraKey("Ctrl").tap();
    await expect(app.extraKey("Ctrl")).toHaveAttribute("aria-pressed", "true");
    await input.focus();
    await app.page.setViewportSize(viewport);
    await expect(app.overlayKey("Paste")).toBeVisible();

    await app.overlayKey("Paste").tap();
    // The paste is asynchronous, so wait for it before typing the next letter.
    await expect(terminal).toContainText(/cat-42\s*c/);
    // Ctrl is used up: the next typed letter is a letter, not a control key.
    await app.page.keyboard.type("d");
    await expect(terminal).toContainText(/cat-42\s*cd/);
    await expect(terminal).not.toContainText("^C");
    await expect(terminal).not.toContainText("^D");
  });

  test("Close keyboard still closes the keyboard from its place under the arrows", async ({
    app,
    kbench,
  }) => {
    await openCatWithKeyboardUp(app, kbench);
    const close = await app.overlayKey("Close keyboard").boundingBox();
    const down = await app.overlayKey("Down").boundingBox();
    if (!close || !down) throw new Error("the keys should show");
    expect(close.y).toBeGreaterThan(down.y);

    await app.overlayKey("Close keyboard").tap();
    await expect(app.extraKey("Ctrl")).toBeVisible();
    await expect(app.overlayKey("Paste")).toBeHidden();
  });
});

test("the folder picker is a full-screen sheet with Places as a row of chips above the breadcrumbs", async ({
  app,
}) => {
  await app.openDrawer();
  await app.page.getByRole("button", { name: "New Workspace" }).tap();

  await expect(app.place("Home")).toBeVisible();
  const viewport = app.page.viewportSize();
  const sheet = await app.folderPicker.boundingBox();
  const home = await app.place("Home").boundingBox();
  const computer = await app.place("Computer").boundingBox();
  const breadcrumbs = await app.folderPicker
    .getByRole("navigation", { name: "Breadcrumbs" })
    .boundingBox();
  if (!viewport || !sheet || !home || !computer || !breadcrumbs) {
    throw new Error("the sheet, its Places and its breadcrumbs should show");
  }
  expect(sheet).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  expect(computer.y).toBe(home.y);
  expect(computer.x).toBeGreaterThan(home.x);
  expect(home.y + home.height).toBeLessThanOrEqual(breadcrumbs.y);
});
