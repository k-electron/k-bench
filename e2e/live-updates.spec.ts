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
  await expect(otherDevice.page.getByRole("status")).toContainText(
    "This Session was deleted",
  );
  await expect(otherDevice.session("session 1")).toBeVisible();
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
