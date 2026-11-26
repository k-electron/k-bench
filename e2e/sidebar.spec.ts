import { expect, test } from "./harness.ts";

test("opening a Workspace unfolds only it in the sidebar, with its Session and Workspace menus", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  // The first Workspace is the Open one until another is opened.
  await app.createSession("alpha");
  await expect(app.session("session 1")).toBeVisible();

  await app.openWorkspace("beta");

  await expect(app.session("session 1")).toHaveCount(0);
  await expect(app.session("Prime")).toHaveCount(1);
  await expect(app.session("Worker")).toHaveCount(1);
  await expect(app.newSessionButton("beta")).toBeVisible();
  await expect(app.newSessionButton("alpha")).toHaveCount(0);
  await expect(app.workspaceActions("alpha")).toHaveCount(0);
  // Every Workspace is still listed.
  expect(await app.workspaceNames()).toEqual(["alpha", "beta"]);
});

test("a Bell in a folded Workspace's Session shows as a dot on its tile", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  await app.createSession("alpha");
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await app.openWorkspace("beta");

  await kbench.ringBell("session 1");

  await expect(app.workspaceBellHint("alpha")).toBeVisible();
  await expect(app.workspaceBellHint("beta")).toHaveCount(0);

  // Unfolded, the Session's own row shows the Bell instead of the tile.
  await app.openWorkspace("alpha");

  await expect(app.bellBadge("session 1")).toBeVisible();
  await expect(app.workspaceBellHint("alpha")).toHaveCount(0);
});

test("an icon-only button shows its name in a tooltip on hover", async ({
  app,
  page,
}) => {
  await page.getByRole("button", { name: "Collapse sidebar" }).hover();
  await expect(page.getByRole("tooltip", { name: "Collapse sidebar" })).toBeVisible();

  await app.collapseSidebar();
  await page.getByRole("button", { name: "New Workspace" }).hover();

  await expect(page.getByRole("tooltip", { name: "New Workspace" })).toBeVisible();
});

test("the collapsed sidebar shows tiles and the Open Workspace's Session icons, and is remembered across a reload", async ({
  app,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  await app.createSession("alpha");
  await expect(app.terminalIn("right", "session 1")).toBeVisible();

  await app.collapseSidebar();

  const collapsed = async () => {
    await expect(app.expandSidebarButton).toBeVisible();
    // The tree's rows are gone; each Workspace is a tile.
    expect(await app.workspaceNames()).toEqual([]);
    await expect(app.workspaceTile("alpha")).toBeVisible();
    await expect(app.workspaceTile("beta")).toBeVisible();
    // The Open Workspace's Sessions are icons under its tile.
    for (const name of ["Prime", "Worker", "session 1"]) {
      await expect(app.session(name)).toBeVisible();
    }
  };
  await collapsed();
  await page.reload();
  await collapsed();

  await app.workspaceTile("beta").click();

  await expect(app.workspaceTitle).toHaveText("beta");
  await expect(app.session("session 1")).toHaveCount(0);
  await expect(app.session("Prime")).toBeVisible();

  await app.expandSidebarButton.click();

  await expect(app.workspace("beta")).toBeVisible();
  expect(await app.workspaceNames()).toEqual(["alpha", "beta"]);
});
