import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("a turn nobody sent ends while the page is hidden: the row pulses on every device until the Agent is shown again", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(otherDevice.sessionStatus("session 1", "idle")).toBeVisible();

  // The Agent is open in a Pane, but the tab is in the background: that is not viewing.
  await app.setPageVisible(false);
  kbench.instance.fakeClaude.spontaneous([
    { text: ["Checking", { hold: "loop" }, " again"] },
  ]);
  await expect(app.sessionStatus("session 1", "working")).toBeVisible();
  kbench.instance.fakeClaude.release("loop");

  await expect(app.rowPulse("session 1")).toBeVisible();
  await expect(otherDevice.rowPulse("session 1")).toBeVisible();
  // Not the orange of Waiting for you: the Agent is Idle, it only has something to show.
  await expect(app.rowWaiting("session 1")).toHaveCount(0);

  // The tab comes to the front: viewing it on one device clears it on all of them.
  await app.setPageVisible(true);
  await expect(app.rowPulse("session 1")).toHaveCount(0);
  await expect(otherDevice.rowPulse("session 1")).toHaveCount(0);
});

test("a turn that ends while a visible page shows the Agent raises nothing", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([{ text: ["Reading", { hold: "mid" }, " done"] }]);
  await app.agentInput("session 1").fill("look");
  await app.agentInput("session 1").press("Enter");
  await expect(app.sessionStatus("session 1", "working")).toBeVisible();

  kbench.instance.fakeClaude.release("mid");

  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("done");
  // The runtime raises the Bell before it says Idle, so Idle with no pulse is the answer.
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(otherDevice.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(app.rowPulse("session 1")).toHaveCount(0);
  await expect(otherDevice.rowPulse("session 1")).toHaveCount(0);
});
