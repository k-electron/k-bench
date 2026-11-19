import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("a Claude Agent's dot, row edge and top bar follow Idle, Working, Waiting for you and back, and a collapsed Workspace turns orange", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;

  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText("Idle");
  const idleEdge = await app.rowEdge("session 1");
  expect(idleEdge).not.toBe("none");

  fakeClaude.script([
    { text: ["Looking", { hold: "mid" }, " around"] },
    { tool: { name: "Bash", input: { command: "ls" } }, ask: true, result: "a.txt" },
    { text: "all listed" },
  ]);
  await app.agentInput("session 1").fill("what is here?");
  await app.agentInput("session 1").press("Enter");

  await expect(app.sessionStatus("session 1", "working")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText(/Working · \d+s/);
  // Green and brighter than Idle's faint edge.
  expect(await app.rowEdge("session 1")).not.toBe(idleEdge);
  await expect(app.rowWaiting("session 1")).toHaveCount(0);

  fakeClaude.release("mid");
  await expect(app.sessionStatus("session 1", "waiting for you")).toBeVisible();
  await expect(app.rowWaiting("session 1")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText("Waiting for you");
  await expect(app.paneLabel(1)).not.toContainText("Working");

  // Out of sight in a collapsed Workspace, the Workspace says it for the Agent.
  await app.createWorkspace(kbench.instance.makeFolder("other"));
  await expect(app.workspaceWaiting("project")).toHaveCount(0);
  await app.collapseWorkspace("project");
  await expect(app.session("session 1")).toBeHidden();
  await expect(app.workspaceWaiting("project")).toBeVisible();
  await expect(app.workspaceWaiting("other")).toHaveCount(0);
  await app.expandWorkspace("project");
  await expect(app.workspaceWaiting("project")).toHaveCount(0);

  await app.permissionPrompt("session 1").getByRole("button", { name: "Allow" }).click();
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("all listed");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText("Idle");
  await expect(app.rowWaiting("session 1")).toHaveCount(0);
});

test("a turn nobody sent makes the Agent Working, then Idle", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();

  kbench.instance.fakeClaude.spontaneous([
    { text: ["Checking", { hold: "loop" }, " again"] },
  ]);
  await expect(app.sessionStatus("session 1", "working")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText("Working");

  kbench.instance.fakeClaude.release("loop");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
});

test("a Stopped Agent is hollow with no edge, says Stopped in the top bar, and is Idle again once restarted", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();

  // Claude Code crashes mid-turn: the runtime and so the Agent end.
  kbench.instance.fakeClaude.script([{ exit: 1, stderr: "boom" }]);
  await app.agentInput("session 1").fill("go");
  await app.agentInput("session 1").press("Enter");

  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText("Stopped");
  expect(await app.rowEdge("session 1")).toBe("none");

  await app.sessionMenu("session 1", "Restart");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(app.paneLabel(1)).toContainText("Idle");
});

test("an Agent waiting on an ask is still Waiting for you after k-bench restarts, on every device", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    { tool: { name: "Bash", input: { command: "make" } }, ask: true },
    { text: "built" },
  ]);
  await app.agentInput("session 1").fill("build it");
  await app.agentInput("session 1").press("Enter");
  await expect(app.sessionStatus("session 1", "waiting for you")).toBeVisible();

  await kbench.stopServer();
  await kbench.startServer();

  await expect(app.sessionStatus("session 1", "waiting for you")).toBeVisible();
  await otherDevice.page.reload();
  await expect(otherDevice.sessionStatus("session 1", "waiting for you")).toBeVisible();
  await expect(otherDevice.rowWaiting("session 1")).toBeVisible();
});
