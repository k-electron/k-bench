import { expect, test } from "./harness.ts";

// These run on the `phone` project: a touch device narrower than the layout breakpoint.

test("the phone shows a single Pane and no Pane-count toggle", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");

  await expect(app.pane(1)).toBeVisible();
  await expect(app.terminal("session 1")).toBeVisible();
  await expect(app.pane(2)).toHaveCount(0);
  await expect(app.panesToggle).toHaveCount(0);
});

test("the phone shows the open Session's label beside the Menu button", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"), { name: "alpha" });
  await app.createSession("alpha");
  await expect(app.terminal("session 1")).toBeVisible();

  await expect(app.paneLabel(1)).toHaveText("alpha › session 1");
  const menu = await app.page
    .getByRole("button", { name: "Menu", exact: true })
    .boundingBox();
  const label = await app.paneLabel(1).boundingBox();
  if (!menu || !label) throw new Error("The Menu button and the label should both show");
  expect(label.x).toBeGreaterThanOrEqual(menu.x + menu.width);
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

test("the phone's open Session survives a reload", async ({ app, kbench }) => {
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
  await expect(app.terminal("session 2")).toHaveCount(0);
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
