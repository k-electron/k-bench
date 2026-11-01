import { expect, test } from "./harness.ts";

test("rename a Workspace from its row menu; the new name survives a reload", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("app"));
  await expect(app.workspace("app")).toBeVisible();

  await app.workspaceAction("app", "Rename");
  await app.page.getByRole("textbox", { name: "Name" }).fill("Billing");
  await app.page.getByRole("button", { name: "Save" }).click();

  await expect(app.workspace("Billing")).toBeVisible();
  await app.page.reload();
  await expect(app.workspace("Billing")).toBeVisible();
  await expect(app.workspace("app")).toHaveCount(0);
});

test("renaming to a name that is taken shows the message and keeps the dialog open", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("a"), { name: "Billing" });
  await app.createWorkspace(kbench.instance.makeFolder("b"), { name: "Search" });
  await expect(app.workspace("Search")).toBeVisible();

  await app.workspaceAction("Search", "Rename");
  await app.page.getByRole("textbox", { name: "Name" }).fill("Billing");
  await app.page.getByRole("button", { name: "Save" }).click();

  await expect(app.page.getByRole("alert")).toContainText("Billing");
  await expect(app.page.getByRole("button", { name: "Save" })).toBeVisible();
});

test("change a Workspace's folder; a folder that does not exist shows the message", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("old"));
  const moved = kbench.instance.makeFolder("moved");
  await expect(app.workspace("old")).toBeVisible();

  await app.workspaceAction("old", "Change folder");
  await app.page
    .getByRole("textbox", { name: "Folder path" })
    .fill(`${kbench.instance.root}/nope`);
  await app.page.getByRole("button", { name: "Save" }).click();
  await expect(app.page.getByRole("alert")).toContainText("does not exist");

  await app.page.getByRole("textbox", { name: "Folder path" }).fill(moved);
  await app.page.getByRole("button", { name: "Save" }).click();

  await expect(app.page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(app.workspace("old")).toHaveAttribute("title", moved);
});

test("dragging a Workspace in the sidebar reorders it, and the order survives a reload", async ({
  app,
  kbench,
}) => {
  for (const name of ["first", "second", "third"]) {
    await app.createWorkspace(kbench.instance.makeFolder(name));
    await expect(app.workspace(name)).toBeVisible();
  }
  expect(await app.workspaceNames()).toEqual(["first", "second", "third"]);

  await app.dragWorkspaceOnto("third", "first");

  await expect.poll(() => app.workspaceNames()).toEqual(["third", "first", "second"]);
  await app.page.reload();
  await expect(app.workspace("third")).toBeVisible();
  expect(await app.workspaceNames()).toEqual(["third", "first", "second"]);
});

test("deleting a Workspace asks first; cancelling keeps everything, confirming ends its Sessions", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("doomed"));
  await app.createSession("doomed");
  await app.session("session 1").click();
  await app.runMarker(app.terminal("session 1"), "kb-before-delete-77");

  await app.workspaceAction("doomed", "Delete");
  const confirm = app.page.getByRole("alertdialog");
  await expect(confirm).toContainText("doomed");
  await confirm.getByRole("button", { name: "Cancel" }).click();

  await expect(app.workspace("doomed")).toBeVisible();
  await expect(app.session("session 1")).toBeVisible();
  await expect(app.terminal("session 1")).toContainText("kb-before-delete-77");

  await app.workspaceAction("doomed", "Delete");
  await app.page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete Workspace" })
    .click();

  await expect(app.workspace("doomed")).toHaveCount(0);
  await expect(app.session("session 1")).toHaveCount(0);
  await expect(app.terminal("session 1")).toHaveCount(0);
  await app.page.reload();
  await expect(app.workspace("doomed")).toHaveCount(0);
});
