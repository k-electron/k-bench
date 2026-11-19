import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("an unsent draft stays with its Claude Agent on this device across a reload, and sending clears it", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project", { name: "first" });
  await app.createClaudeAgent("project", { name: "second" });
  await otherDevice.session("first").click();

  await app.session("first").click();
  await app.agentInput("first").fill("half a thought");
  await app.page.reload();
  await expect(app.agentInput("first")).toHaveValue("half a thought");

  // It belongs to that Agent, on that device.
  await app.session("second").click();
  await expect(app.agentInput("second")).toHaveValue("");
  await expect(otherDevice.agentInput("first")).toHaveValue("");
  await otherDevice.page.reload();
  await expect(otherDevice.agentInput("first")).toHaveValue("");

  // Sent, it is gone: a reload brings back an empty box, not the sent text.
  await app.session("first").click();
  await app.agentInput("first").press("Enter");
  await expect(app.agentRegion("first").getByRole("log")).toContainText(
    "fake claude heard: half a thought",
  );
  await app.page.reload();
  await expect(app.agentInput("first")).toHaveValue("");
});

test("the input still works when browser storage is unavailable", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await app.page.addInitScript(() => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  await app.page.reload();
  // The Pane layout is in storage too, so the Agent has to be opened again.
  await app.session("session 1").click();

  await app.agentInput("session 1").fill("still typing");
  await expect(app.agentInput("session 1")).toHaveValue("still typing");
  await app.agentInput("session 1").press("Enter");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: still typing",
  );
});
