import { expect, test } from "./harness.ts";

test("rename a Session from its row menu", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.createSession("project");
  await expect(app.session("session 2")).toBeVisible();

  await app.sessionMenu("session 1", "Rename");
  const dialog = app.page.getByRole("dialog", { name: "Rename Session" });
  await dialog.getByRole("textbox", { name: "Session name" }).fill("build");
  await dialog.getByRole("button", { name: "Rename" }).click();

  await expect(dialog).toBeHidden();
  await expect(app.session("build")).toBeVisible();
  await expect(app.session("session 1")).toBeHidden();
  // Same position in the list: the rename did not reorder the Sessions.
  await expect(
    app.sidebar.getByRole("button", { name: /^(build|session 2)$/ }),
  ).toHaveText(["build", "session 2"]);
});

test("renaming to a name already taken in the Workspace is refused with a message", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.createSession("project");
  await expect(app.session("session 2")).toBeVisible();

  await app.sessionMenu("session 2", "Rename");
  const dialog = app.page.getByRole("dialog", { name: "Rename Session" });
  await dialog.getByRole("textbox", { name: "Session name" }).fill("session 1");
  await dialog.getByRole("button", { name: "Rename" }).click();

  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await dialog.getByRole("textbox", { name: "Session name" }).fill("session 3");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(app.session("session 3")).toBeVisible();
});

test("deleting a Session asks for confirmation, and cancelling keeps it", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminal("session 1")).toBeVisible();

  await app.sessionMenu("session 1", "Delete");
  const dialog = app.page.getByRole("alertdialog", { name: "Delete session 1?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(app.session("session 1")).toBeVisible();
  await app.runMarker(app.terminal("session 1"), "kb-still-here-8841");
});

test("confirming the deletion removes the Session and empties its Pane", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.createSession("project");
  await expect(app.terminal("session 2")).toBeVisible();

  await app.sessionMenu("session 2", "Delete");
  await app.page
    .getByRole("alertdialog", { name: "Delete session 2?" })
    .getByRole("button", { name: "Delete session" })
    .click();

  await expect(app.session("session 2")).toBeHidden();
  await expect(app.terminal("session 2")).toBeHidden();
  await expect(app.session("session 1")).toBeVisible();
  // The freed name is handed out again.
  await app.createSession("project");
  await expect(app.session("session 2")).toBeVisible();
});
