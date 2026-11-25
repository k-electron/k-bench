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
