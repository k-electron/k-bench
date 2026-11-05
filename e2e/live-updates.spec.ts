import { expect, test } from "./harness.ts";

test("a Workspace and Session created on one device appear on the other without a reload", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await expect(otherDevice.workspace("project")).toBeVisible();

  await app.createSession("project");

  await expect(otherDevice.session("session 1")).toBeVisible();
});

test("renaming a Session on one device renames it on the other", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(otherDevice.session("session 1")).toBeVisible();

  await app.sessionMenu("session 1", "Rename");
  const dialog = app.page.getByRole("dialog", { name: "Rename Session" });
  await dialog.getByRole("textbox", { name: "Session name" }).fill("build");
  await dialog.getByRole("button", { name: "Rename" }).click();

  await expect(otherDevice.session("build")).toBeVisible();
  await expect(otherDevice.session("session 1")).toBeHidden();
});

test("deleting a Session on one device empties the Pane showing it on the other, with a notice", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.createSession("project");
  await otherDevice.session("session 2").click();
  await expect(otherDevice.terminal("session 2")).toBeVisible();
  await otherDevice.runMarker(otherDevice.terminal("session 2"), "kb-watching-3377");

  await app.sessionMenu("session 2", "Delete");
  await app.page
    .getByRole("alertdialog", { name: "Delete session 2?" })
    .getByRole("button", { name: "Delete session" })
    .click();

  await expect(otherDevice.terminal("session 2")).toBeHidden();
  await expect(otherDevice.session("session 2")).toBeHidden();
  await expect(
    otherDevice.page.getByRole("status", { name: "Pane notice" }),
  ).toContainText("This Session was deleted");
  await expect(otherDevice.session("session 1")).toBeVisible();
});

test("a Session deleted while the window is narrowed leaves its notice on the same Pane after widening", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  const page = otherDevice.page;
  await otherDevice.session("session 1").click();
  await otherDevice.session("session 2").click({ modifiers: ["Meta"] });
  await page.keyboard.press("Meta+Backslash");
  await expect(otherDevice.terminalIn(2, "session 2")).toBeVisible();
  const wide = page.viewportSize();
  if (!wide) throw new Error("The test page should have a viewport");

  await page.setViewportSize({ width: 500, height: wide.height });
  await expect(otherDevice.terminal("session 2")).toBeVisible();

  await app.sessionMenu("session 2", "Delete");
  await app.page
    .getByRole("alertdialog", { name: "Delete session 2?" })
    .getByRole("button", { name: "Delete session" })
    .click();
  await expect(page.getByRole("status", { name: "Pane notice" })).toContainText(
    "This Session was deleted",
  );

  await page.setViewportSize(wide);
  await expect(otherDevice.terminalIn(1, "session 1")).toBeVisible();
  await expect(
    otherDevice.pane(2).getByRole("status", { name: "Pane notice" }),
  ).toContainText("This Session was deleted");
  await expect(
    otherDevice.pane(1).getByRole("status", { name: "Pane notice" }),
  ).toHaveCount(0);
});

test("a shell that exits shows as Stopped on the other device too", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(otherDevice.sessionStatus("session 1", "running")).toBeVisible();

  const terminal = app.terminal("session 1");
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("exit");
  await app.page.keyboard.press("Enter");

  await expect(otherDevice.sessionStatus("session 1", "stopped")).toBeVisible();
});
