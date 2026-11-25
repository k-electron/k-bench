import { expect, test } from "./harness.ts";

test("create a Workspace by browsing to a folder; it appears in the sidebar under the folder's name", async ({
  app,
  kbench,
}) => {
  kbench.instance.makeFolder("my-project");

  await app.createWorkspaceByBrowsing("my-project");

  await expect(app.workspace("my-project")).toBeVisible();
});

test("a second Workspace on the same folder is refused, naming the one that has it", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("my-project");

  await app.createWorkspace(folder, { name: "Billing" });
  await expect(app.workspace("Billing")).toBeVisible();
  await app.createWorkspace(folder);

  await expect(app.page.getByRole("alert")).toContainText(
    'A Workspace for this folder already exists: "Billing"',
  );
});

test("a name that is already taken shows the message and keeps the dialog open", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("a"), { name: "Billing" });
  await expect(app.workspace("Billing")).toBeVisible();

  await app.createWorkspace(kbench.instance.makeFolder("b"), { name: "Billing" });

  await expect(app.page.getByRole("alert")).toContainText("Billing");
  await expect(app.page.getByRole("button", { name: "Create Workspace" })).toBeVisible();
});

test("a folder that does not exist shows the message", async ({ app, kbench }) => {
  await app.createWorkspace(`${kbench.instance.root}/nope`);

  await expect(app.page.getByRole("alert")).toContainText("does not exist");
});
