import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh: the SDK-driven one for the Agent
// and the terminal stub once the Session is in the terminal. Nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("Open in terminal from the row menu switches the same Session to a Claude TUI on the same conversation, on every device", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  await app.agentInput("session 1").fill("before");
  await app.agentInput("session 1").press("Enter");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: before",
  );
  await expect(otherDevice.agentRegion("session 1")).toBeVisible();

  // Idle: nothing to confirm.
  await app.sessionMenu("session 1", "Open in terminal");

  for (const device of [app, otherDevice]) {
    await expect(device.terminal("session 1")).toContainText("claude-stub ready");
    await expect(device.terminal("session 1")).toContainText("claude-stub arg: --resume");
    await expect(device.agentRegion("session 1")).toHaveCount(0);
  }
  // It is the same Session: still one row, running.
  await expect(app.session("session 1")).toHaveCount(1);
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
});

test("from the top bar it confirms first when a background task runs, listing it, and a Stopped Agent opens straight in the terminal", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    {
      tool: {
        name: "Bash",
        input: { command: "pnpm dev", run_in_background: true },
        id: "toolu_dev",
      },
      task: { id: "dev", description: "pnpm dev", type: "bash", background: true },
      result: "Command running in background with ID: dev",
    },
    { text: "started" },
  ]);
  await app.agentInput("session 1").fill("start the dev server");
  await app.agentInput("session 1").press("Enter");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("started");

  await app.page.getByRole("button", { name: "Open in terminal", exact: true }).click();
  const confirm = app.page.getByRole("alertdialog", { name: "Open in terminal?" });
  await expect(confirm).toContainText("Background task: pnpm dev");
  // Backing out leaves it where it was.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(app.agentRegion("session 1")).toBeVisible();

  await app.page.getByRole("button", { name: "Open in terminal", exact: true }).click();
  await confirm.getByRole("button", { name: "Open in terminal" }).click();
  await expect(app.terminal("session 1")).toContainText("claude-stub arg: --resume");

  // A Stopped Agent goes straight there.
  await app.createClaudeAgent("project");
  await app.sessionMenu("session 2", "Stop");
  await expect(app.sessionStatus("session 2", "stopped")).toBeVisible();
  await app.sessionMenu("session 2", "Open in terminal");
  await expect(app.terminal("session 2")).toContainText("claude-stub ready");
});

test("an Unsupported row offers Open in terminal", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    {
      system: {
        subtype: "local_command_output",
        content: "/plugin isn't available in this environment.",
      },
    },
    { text: "That is all." },
  ]);
  await app.agentInput("session 1").fill("try it");
  await app.agentInput("session 1").press("Enter");
  const row = app
    .agentRegion("session 1")
    .getByRole("log")
    .getByRole("article", { name: "Unsupported" });

  await row.getByRole("button", { name: "Open in terminal" }).click();

  await expect(app.terminal("session 1")).toContainText("claude-stub ready");
});

test("while Claude waits for an Allow/Deny it confirms first, and the tool is never allowed", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    { tool: { name: "Bash", input: { command: "rm -rf build" } }, ask: true },
    { text: "done" },
  ]);
  await app.agentInput("session 1").fill("clean up");
  await app.agentInput("session 1").press("Enter");
  await expect(app.permissionPrompt("session 1")).toBeVisible();

  await app.sessionMenu("session 1", "Open in terminal");
  const confirm = app.page.getByRole("alertdialog", { name: "Open in terminal?" });
  await expect(confirm).toContainText("Claude is waiting for you");
  await confirm.getByRole("button", { name: "Open in terminal" }).click();

  await expect(app.terminal("session 1")).toContainText("claude-stub ready");
  expect(
    kbench.instance.fakeClaude
      .received()
      .some(
        (entry) =>
          entry.kind === "control_response" &&
          JSON.stringify(entry.message).includes('"allow"'),
      ),
  ).toBe(false);
});
