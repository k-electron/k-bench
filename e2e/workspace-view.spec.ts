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
