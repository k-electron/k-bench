import { expect, test } from "./harness.ts";

test("opening a Workspace shows its Prime on the left and its Worker on the right, named in the top bar and the title", async ({
  app,
  kbench,
  page,
}) => {
  const one = kbench.instance.makeFolder("one");
  const two = kbench.instance.makeFolder("two");
  await app.createWorkspace(one, { name: "alpha" });
  await app.createWorkspace(two, { name: "beta" });

  // Loading k-bench opens the Open Workspace (the first, as none was opened), starting it.
  await page.reload();
  await expect(app.terminalIn("left", "Prime")).toContainText(`claude-stub cwd: ${one}`);
  await expect(app.terminalIn("left", "Prime")).toContainText("claude-stub ready");
  await expect(app.terminalIn("right", "Worker")).toContainText("claude-stub ready");
  await expect(app.workspaceTitle).toHaveText("alpha");
  await expect(page).toHaveTitle("alpha — k-bench");

  await app.openWorkspace("beta");

  await expect(app.terminalIn("left", "Prime")).toContainText(`claude-stub cwd: ${two}`);
  await expect(app.terminalIn("left", "Prime")).toContainText("claude-stub ready");
  await expect(app.terminalIn("right", "Worker")).toContainText(
    `claude-stub cwd: ${two}`,
  );
  await expect(app.terminalIn("right", "Worker")).toContainText("claude-stub ready");
  await expect(app.pane("left")).toContainText("Prime");
  await expect(app.workspaceTitle).toHaveText("beta");
  await expect(app.workspaceTitle).toHaveAttribute("title", two);
  await expect(page).toHaveTitle("beta — k-bench");
});

test("an Other Session opens in the right Pane, never the left, and only Pane Sessions are highlighted", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);

  await expect(app.terminalIn("right", "session 2")).toBeVisible();
  await app.session("session 1").click();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await expect(app.terminal("session 2")).toHaveCount(0);
  await expect(app.pane("left").getByRole("region")).toHaveAccessibleName(
    "Terminal Prime",
  );
  await expect(app.session("session 1")).toHaveAttribute("aria-current", "true");
  await expect(app.session("Prime")).toHaveAttribute("aria-current", "true");
  await expect(app.session("session 2")).not.toHaveAttribute("aria-current", "true");

  // Choosing the Worker brings it back on the right.
  await app.session("Worker").click();
  await expect(app.pane("right").getByRole("region")).toHaveAccessibleName(
    "Terminal Worker",
  );
  await expect(app.terminal("session 1")).toHaveCount(0);
});

test("another device follows when one opens a Workspace", async ({
  app,
  otherDevice,
  kbench,
}) => {
  const two = kbench.instance.makeFolder("two");
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(two, { name: "beta" });
  await expect(otherDevice.workspaceTitle).toHaveText("alpha");

  await app.openWorkspace("beta");

  await expect(otherDevice.workspaceTitle).toHaveText("beta");
  await expect(otherDevice.page).toHaveTitle("beta — k-bench");
  await expect(otherDevice.terminalIn("left", "Prime")).toContainText(
    `claude-stub cwd: ${two}`,
  );
});

test("dragging the divider resizes the right Pane's terminal and its shell sees the new size", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const right = app.terminalIn("right", "session 1");
  const before = (await app.terminalSize(right)).cols;

  await app.dragDivider(250);

  await expect
    .poll(async () => (await app.terminalSize(right)).cols)
    .toBeLessThan(before);
});

test("dragging the divider to an edge shuts the left Pane to a rail, and opening it again brings back the split it had", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await app.dragDivider(-200);
  const split = await app.dividerPercent();
  expect(split).toBeLessThan(40);

  await app.shutPane("left");

  await expect(app.rail("left", "Prime")).toBeVisible();
  await expect(app.terminal("Prime")).toHaveCount(0);
  await expect(app.terminalIn("right", "Worker")).toBeVisible();

  await app.rail("left", "Prime").click();

  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  expect(await app.dividerPercent()).toBe(split);

  // Opening the Prime from the sidebar reopens its shut Pane too.
  await app.shutPane("left");
  await expect(app.rail("left", "Prime")).toBeVisible();
  await app.session("Prime").click();
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  expect(await app.dividerPercent()).toBe(split);

  // Double-clicking the divider gives half and half.
  await app.divider.dblclick();
  await expect(app.divider).toHaveAttribute("aria-valuenow", "50");
});

test("each Workspace's split and shut Pane are kept on this device across a reload, and not on another device", async ({
  app,
  otherDevice,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await app.dragDivider(-200);
  const alphaSplit = await app.dividerPercent();
  await app.openWorkspace("beta");
  await expect(app.workspaceTitle).toHaveText("beta");
  await app.shutPane("right");
  await expect(app.rail("right", "Worker")).toBeVisible();

  await page.reload();

  await expect(app.workspaceTitle).toHaveText("beta");
  await expect(app.rail("right", "Worker")).toBeVisible();
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await expect(otherDevice.terminalIn("right", "Worker")).toBeVisible();
  await app.openWorkspace("alpha");
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
  expect(await app.dividerPercent()).toBe(alphaSplit);

  // Opening a Workspace by its name reopens its shut right Pane.
  await app.openWorkspace("beta");
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
});

test("a Bell rung in a shut Pane's Session shows on its rail", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await app.shutPane("right");
  await expect(app.rail("right", "session 1")).toBeVisible();
  await expect(app.railBell("right", "session 1")).toHaveCount(0);

  await kbench.ringBell("session 1");

  await expect(app.railBell("right", "session 1")).toBeVisible();

  // Opening the Session from the sidebar reopens the Pane, and seeing it clears the Bell.
  await app.session("session 1").click();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await expect(app.bellBadge("session 1")).toHaveCount(0);
});
