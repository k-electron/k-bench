import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("Shift+Tab in the input cycles the permission mode in Claude TUI's order, and every device shows the same one", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  const line = app.agentModeLine("session 1");
  const otherLine = otherDevice.agentModeLine("session 1");
  await expect(line).toContainText("Ask before edits");
  await expect(otherLine).toContainText("Ask before edits");

  await app.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Accept edits");
  await expect(otherLine).toContainText("Accept edits");
  await app.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Plan mode");
  await expect(otherLine).toContainText("Plan mode");
  // Shift+Tab stayed in the box: it neither moved the focus nor wrote anything.
  await expect(app.agentInput("session 1")).toBeFocused();
  await expect(app.agentInput("session 1")).toHaveValue("");

  // Auto mode follows plan mode, where the model supports it (as in the TUI).
  await otherDevice.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Auto mode");
  await expect(otherLine).toContainText("Auto mode");

  // The other device can take it round again, and the first follows.
  await otherDevice.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Ask before edits");
  await expect(otherLine).toContainText("Ask before edits");
});

test("the cycle leaves out auto mode when the model does not support it", async ({
  app,
  kbench,
}) => {
  kbench.instance.fakeClaude.configure({ autoMode: false });
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const line = app.agentModeLine("session 1");
  await expect(line).toContainText("Ask before edits");
  await app.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Accept edits");
  await app.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Plan mode");
  await app.agentInput("session 1").press("Shift+Tab");
  await expect(line).toContainText("Ask before edits");
});

test("a tap on the mode line cycles it, and a change Claude Code makes itself shows on every device and after a reload", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  await app.agentModeLine("session 1").click();
  await expect(app.agentModeLine("session 1")).toContainText("Accept edits");
  await expect(otherDevice.agentModeLine("session 1")).toContainText("Accept edits");

  kbench.instance.fakeClaude.script([{ text: "switching" }, { mode: "plan" }]);
  await app.agentInput("session 1").fill("go");
  await app.agentInput("session 1").press("Enter");
  await expect(app.agentModeLine("session 1")).toContainText("Plan mode");
  await expect(otherDevice.agentModeLine("session 1")).toContainText("Plan mode");

  await otherDevice.page.reload();
  await expect(otherDevice.agentModeLine("session 1")).toContainText("Plan mode");
});
