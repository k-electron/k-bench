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

test("type a path in the picker: Tab completes a folder, Enter goes there, and a tail that doesn't exist becomes new folders", async ({
  app,
  kbench,
}) => {
  const projects = kbench.instance.makeFolder("projects");
  mkdirSync(join(projects, "billing"));
  mkdirSync(join(projects, ".secret"));
  const picker = app.folderPicker;
  const field = picker.getByRole("combobox", { name: "Folder path" });
  const suggestion = (name: string) => app.pathSuggestion(name);

  await app.page.getByRole("button", { name: "New Workspace" }).click();
  await picker.getByRole("button", { name: "Type a path" }).click();
  await field.fill("~/pro");
  await expect(suggestion("projects")).toBeVisible();
  await field.press("Tab");
  await expect(field).toHaveValue("~/projects/");
  await expect(suggestion("billing")).toBeVisible();
  // Hidden folders are offered only once a `.` is typed.
  await expect(suggestion(".secret")).toHaveCount(0);
  await field.press(".");
  await expect(suggestion(".secret")).toBeVisible();
  await field.press("Backspace");
  await field.pressSequentially("bil");
  await expect(suggestion("billing")).toBeVisible();
  await field.press("Tab");
  await expect(field).toHaveValue("~/projects/billing/");
  await field.press("Enter");

  await expect(app.breadcrumb("billing")).toHaveAttribute("aria-current", "location");
  await expect(field).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "Type a path" })).toBeFocused();

  await picker.getByRole("button", { name: "Type a path" }).click();
  await field.fill("~/projects/billing/api/v2");
  await field.press("Enter");
  await expect(picker.getByText("v2 doesn't exist yet")).toBeVisible();
  // Enter never creates anything.
  expect(existsSync(join(projects, "billing", "api"))).toBe(false);
  await app.page.getByRole("button", { name: "Create 2 folders and Workspace" }).click();

  await expect(app.workspace("v2")).toHaveAttribute(
    "title",
    join(projects, "billing", "api", "v2"),
  );
});

test("Create on a folder that already has a Workspace says so and opens that Workspace as its name does", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("my-project");
  await app.createWorkspace(kbench.instance.makeFolder("search"));
  await expect(app.workspace("search")).toBeVisible();
  await app.createWorkspace(folder, { name: "Billing" });
  await expect(app.workspace("Billing")).toBeVisible();
  // Billing's right Pane is left showing an Other Session, then search is opened.
  await app.openWorkspace("Billing");
  await app.createSession("Billing");
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await app.openWorkspace("search");
  await expect(app.workspaceTitle).toHaveText("search");

  await app.createWorkspace(folder);

  await expect(app.page.getByRole("alert")).toContainText(
    "A Workspace for this folder already exists",
  );
  await expect(app.page.getByRole("dialog")).toHaveCount(0);
  // Opened as choosing its name opens it: as it was left.
  await expect(app.workspaceTitle).toHaveText("Billing");
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
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
