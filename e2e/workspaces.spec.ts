import { existsSync, mkdirSync } from "node:fs";
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

test("make nested New folders in the picker; Create makes them, then the Workspace", async ({
  app,
  kbench,
}) => {
  const projects = kbench.instance.makeFolder("projects");
  mkdirSync(join(projects, "acme"));
  const picker = app.folderPicker;

  await app.page.getByRole("button", { name: "New Workspace" }).click();
  await app.place("Home").click();
  await app.folderRow("projects").click();
  // A name that already exists just opens that folder.
  await app.newFolder("acme");
  await expect(app.breadcrumb("acme")).toHaveAttribute("aria-current", "location");
  await expect(picker.getByText("doesn't exist yet")).toHaveCount(0);
  await app.newFolder("client");
  await expect(picker.getByText("client doesn't exist yet")).toBeVisible();
  await app.newFolder("web");
  await expect(picker.getByText("web doesn't exist yet")).toBeVisible();
  await expect(app.page.getByRole("textbox", { name: "Name" })).toHaveAttribute(
    "placeholder",
    "web",
  );
  // An earlier breadcrumb drops the new folders after it.
  await app.breadcrumb("client").click();
  await expect(picker.getByText("client doesn't exist yet")).toBeVisible();
  await app.newFolder("web");
  // Nothing is made until Create.
  expect(existsSync(join(projects, "acme", "client"))).toBe(false);
  await app.page.getByRole("button", { name: "Create 2 folders and Workspace" }).click();

  await expect(app.workspace("web")).toBeVisible();
  await expect(app.workspace("web")).toHaveAttribute(
    "title",
    join(projects, "acme", "client", "web"),
  );
  expect(existsSync(join(projects, "acme", "client", "web"))).toBe(true);
});

test("Create on a folder that already has a Workspace says so and opens that Workspace", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("my-project");
  // The first Workspace is the Open one until another is opened.
  await app.createWorkspace(kbench.instance.makeFolder("search"));
  await expect(app.workspace("search")).toBeVisible();
  await app.createWorkspace(folder, { name: "Billing" });
  await expect(app.workspace("Billing")).toBeVisible();
  const openWorkspaceName = async () => {
    const response = await app.page.request.get(`${kbench.url}/api/state`);
    const state = (await response.json()) as {
      openWorkspaceId: string | null;
      workspaces: Array<{ id: string; name: string }>;
    };
    return state.workspaces.find((w) => w.id === state.openWorkspaceId)?.name;
  };
  expect(await openWorkspaceName()).toBe("search");

  await app.createWorkspace(folder);

  await expect(app.page.getByRole("alert")).toContainText(
    "A Workspace for this folder already exists",
  );
  await expect(app.page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(openWorkspaceName).toBe("Billing");
  expect(await app.workspaceNames()).toEqual(["search", "Billing"]);
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
