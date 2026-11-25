import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./harness.ts";

test("pick a Place, step into a folder and create; the Workspace appears with the folder's name", async ({
  app,
  kbench,
}) => {
  const projects = kbench.instance.makeFolder("projects");
  mkdirSync(join(projects, "billing"));
  mkdirSync(join(projects, "search"));
  await app.createWorkspace(join(projects, "billing"));
  await expect(app.workspace("billing")).toBeVisible();
  // The newest Workspace is now in Home, so the picker opens there, not in projects.
  await app.createWorkspace(kbench.instance.makeFolder("notes"));
  await expect(app.workspace("notes")).toBeVisible();

  await app.page.getByRole("button", { name: "New Workspace" }).click();
  await app.place("projects").click();
  // A folder that already has a Workspace is marked with its name.
  await expect(app.folderRow("billing")).toHaveAccessibleDescription("Workspace billing");
  await app.folderRow("search").click();
  await expect(app.page.getByRole("textbox", { name: "Name" })).toHaveAttribute(
    "placeholder",
    "search",
  );
  await app.page.getByRole("button", { name: "Create Workspace" }).click();

  await expect(app.workspace("search")).toBeVisible();
  await expect(app.workspace("search")).toHaveAttribute(
    "title",
    join(projects, "search"),
  );
});

test("a second Workspace on the same folder is named with a (2) suffix", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("my-project");

  await app.createWorkspace(folder);
  await expect(app.workspace("my-project")).toBeVisible();
  await app.createWorkspace(folder);

  await expect(app.workspace("my-project (2)")).toBeVisible();
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
