import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, scripted to ask for permission;
// nothing here runs the real `claude`, and the Agent Runtime is the real one.

test("an Allow/Deny card takes over the input on every device, and answering on one removes it from the other", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  kbench.instance.fakeClaude.script([
    { tool: { name: "Bash", input: { command: "ls -la" } }, ask: true, result: "ok" },
    { text: "all listed" },
  ]);
  await app.agentInput("session 1").fill("half a message");
  await otherDevice.agentInput("session 1").fill("what is here?");
  await otherDevice.agentInput("session 1").press("Enter");

  for (const device of [app, otherDevice]) {
    const card = device.permissionPrompt("session 1");
    await expect(card).toContainText("Bash");
    await expect(card).toContainText("ls -la");
    // It takes over the input.
    await expect(device.agentInput("session 1")).toBeHidden();
  }

  // A reloaded page shows it too: the ask is in the log, not in the page.
  await otherDevice.page.reload();
  await expect(otherDevice.permissionPrompt("session 1")).toBeVisible();

  await otherDevice
    .permissionPrompt("session 1")
    .getByRole("button", { name: "Allow" })
    .click();

  await expect(app.permissionPrompt("session 1")).toHaveCount(0);
  await expect(otherDevice.permissionPrompt("session 1")).toHaveCount(0);
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("all listed");
  // What was being typed when the card came is still in the box when it goes.
  await expect(app.agentInput("session 1")).toHaveValue("half a message");
});

test("a Deny is told to Claude, and the card waits through a restart of k-bench with its buttons off meanwhile", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  fakeClaude.script([
    { tool: { name: "Bash", input: { command: "make clean" } }, ask: true },
    { text: "left it alone" },
  ]);
  await app.agentInput("session 1").fill("clean up");
  await app.agentInput("session 1").press("Enter");
  const card = app.permissionPrompt("session 1");
  await expect(card).toBeVisible();

  await kbench.stopServer();
  // An answer now would be dropped, so the buttons wait for the connection.
  await expect(app.agentRegion("session 1").getByText("Reconnecting…")).toBeVisible();
  await expect(card.getByRole("button", { name: "Deny" })).toBeDisabled();
  await kbench.startServer();

  await expect(card.getByRole("button", { name: "Deny" })).toBeEnabled();
  await card.getByRole("button", { name: "Deny" }).click();
  await expect(card).toHaveCount(0);
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "left it alone",
  );
  const answers = fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_response" ? [entry.message.response.response] : [],
    );
  expect(answers).toMatchObject([{ behavior: "deny" }]);
});
