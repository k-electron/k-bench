import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, scripted to start a subagent and
// background tasks; nothing here runs the real `claude`, and the Agent Runtime is the real one.

test("a subagent and background tasks show a line with a spinner that turns green when done, and a Stop on one stops only that one", async ({
  app,
  otherDevice,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  const region = app.agentRegion("session 1");

  fakeClaude.script([
    {
      tool: {
        name: "Agent",
        input: { description: "Survey the tests", subagent_type: "Explore" },
        id: "toolu_survey",
      },
      task: { id: "survey", description: "Survey the tests", subagentType: "Explore" },
      hold: "survey",
      result: "Found 12 test files.",
    },
    {
      tool: {
        name: "Bash",
        input: { command: "pnpm dev", run_in_background: true },
        id: "toolu_dev",
      },
      task: { id: "dev", description: "pnpm dev", type: "bash", background: true },
      result: "Command running in background with ID: dev",
    },
    { task: { id: "watch", description: "Watch the logs", background: true } },
    {
      taskProgress: { id: "watch", toolUses: 3, tokens: 1234, lastTool: "Grep" },
    },
    { text: "started" },
  ]);
  // The subagent blocks the turn, so the others start once it is released: its progress shows
  // meanwhile.
  await app.agentInput("session 1").fill("start things");
  await app.agentInput("session 1").press("Enter");
  const survey = region.getByRole("article", {
    name: "Agent(Survey the tests)",
    exact: true,
  });
  await expect(survey.getByRole("img", { name: "Running" })).toBeVisible();
  await expect(
    survey.getByRole("button", { name: "Stop Survey the tests" }),
  ).toBeVisible();

  fakeClaude.release("survey");
  await expect(survey.getByRole("img", { name: "Done" })).toBeVisible();
  await expect(survey.getByRole("button", { name: /^Stop/ })).toHaveCount(0);

  // A command started in the background returned at once, but it still runs: the spinner stays.
  const dev = region.getByRole("article", { name: "Bash(pnpm dev)", exact: true });
  await expect(dev).toContainText("Command running in background");
  await expect(dev.getByRole("img", { name: "Running" })).toBeVisible();
  // A task with no tool call of its own is a line of its own.
  const watch = region.getByRole("article", {
    name: "Subagent(Watch the logs)",
    exact: true,
  });
  await expect(watch.getByRole("img", { name: "Running" })).toBeVisible();
  // Its progress, as Claude Code reported it.
  await expect(watch).toContainText("3 tool uses · 1.2k tokens · Grep");
  // The turn is over, and the tasks go on.
  await expect(region.getByRole("status", { name: "Claude status" })).toHaveCount(0);

  // The same on another device.
  const otherWatch = otherDevice
    .agentRegion("session 1")
    .getByRole("article", { name: "Subagent(Watch the logs)", exact: true });
  await expect(otherWatch.getByRole("img", { name: "Running" })).toBeVisible();

  // Stop on the command ends that one; the other keeps running.
  await dev.getByRole("button", { name: "Stop pnpm dev" }).click();
  await expect(dev.getByRole("img", { name: "Interrupted" })).toBeVisible();
  await expect(dev).toContainText("Stopped");
  await expect(watch.getByRole("img", { name: "Running" })).toBeVisible();
  const stopped = fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_request" && entry.message.request.subtype === "stop_task"
        ? [entry.message.request.task_id]
        : [],
    );
  expect(stopped).toEqual(["dev"]);

  // One that finishes by itself turns green, on every device, and after a reload.
  fakeClaude.endTask("watch");
  await expect(watch.getByRole("img", { name: "Done" })).toBeVisible();
  await expect(otherWatch.getByRole("img", { name: "Done" })).toBeVisible();
  await app.page.reload();
  await expect(watch.getByRole("img", { name: "Done" })).toBeVisible();
  await expect(dev.getByRole("img", { name: "Interrupted" })).toBeVisible();
});
