import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, scripted to ask for permission;
// nothing here runs the real `claude`, and the Agent Runtime is the real one.

test("a permission panel takes over the input on every device, and answering on one removes it from the other", async ({
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
    .getByRole("button", { name: "1. Yes", exact: true })
    .click();

  await expect(app.permissionPrompt("session 1")).toHaveCount(0);
  await expect(otherDevice.permissionPrompt("session 1")).toHaveCount(0);
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("all listed");
  // What was being typed when the card came is still in the box when it goes.
  await expect(app.agentInput("session 1")).toHaveValue("half a message");
});

test("a denial with a reply is told to Claude, and the panel waits through a restart of k-bench with its choices off meanwhile", async ({
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
  const deny = card.getByRole("button", {
    name: "2. No, and tell Claude what to do differently",
  });
  await expect(deny).toBeDisabled();
  await kbench.startServer();

  await expect(deny).toBeEnabled();
  await deny.click();
  // The input stays hidden until the reply is asked for, and the reply goes with the denial.
  await expect(app.agentInput("session 1")).toBeHidden();
  await card
    .getByRole("textbox", { name: "Tell Claude what to do differently" })
    .fill("keep the build folder");
  await card.getByRole("button", { name: "Send", exact: true }).click();
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
  expect((answers[0] as { message: string }).message).toContain("keep the build folder");
});

test("an edit's panel shows the diff and numbered choices; 'don't ask again' sends Claude Code's own suggestion, and each answer leaves a permission line", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  const suggestion = {
    type: "addRules",
    rules: [{ toolName: "Edit" }],
    behavior: "allow",
    destination: "session",
  };
  fakeClaude.script([
    {
      tool: {
        name: "Edit",
        input: { file_path: "notes.txt", old_string: "old line", new_string: "new line" },
      },
      ask: { suggestions: [suggestion] },
      result: "edited",
    },
    { text: "edit made" },
  ]);
  fakeClaude.script([
    { tool: { name: "Bash", input: { command: "rm notes.txt" } }, ask: true },
    { text: "left it" },
  ]);
  const log = app.agentRegion("session 1").getByRole("log");

  await app.agentInput("session 1").fill("change the note");
  await app.agentInput("session 1").press("Enter");
  const panel = app.permissionPrompt("session 1");
  await expect(panel.getByRole("figure", { name: "Diff of notes.txt" })).toContainText(
    "old line",
  );
  await expect(panel.getByRole("figure", { name: "Diff of notes.txt" })).toContainText(
    "new line",
  );
  await expect(panel.getByRole("button", { name: "1. Yes", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "2. Yes, don't ask again" }).click();
  await expect(panel).toHaveCount(0);
  await expect(log).toContainText("permission: allowed, and won't ask again");

  // Claude Code offered nothing to save for this one: the choices are Yes and No.
  await app.agentInput("session 1").fill("remove it");
  await app.agentInput("session 1").press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /don't ask again/ })).toHaveCount(0);
  await panel.getByRole("button", { name: "2. No, and tell Claude" }).click();
  await panel
    .getByRole("textbox", { name: "Tell Claude what to do differently" })
    .fill("keep it");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(log).toContainText("permission: denied: keep it");

  const answers = fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_response" ? [entry.message.response.response] : [],
    );
  expect(answers).toMatchObject([
    { behavior: "allow", updatedPermissions: [suggestion] },
    { behavior: "deny" },
  ]);
  expect((answers[1] as { message: string }).message).toContain("keep it");
});
