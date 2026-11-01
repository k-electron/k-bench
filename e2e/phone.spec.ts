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

test("the drawer opens from the menu button; tapping a Session opens it and closes the drawer", async ({
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
