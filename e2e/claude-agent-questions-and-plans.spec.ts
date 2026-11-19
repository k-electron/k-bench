import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, scripted to ask questions and for
// a plan to be approved; nothing here runs the real `claude`, and the Agent Runtime is the
// real one.

test("Claude's questions show their options on every device, and the answer chosen on one reaches Claude and is left in the Transcript", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  const { fakeClaude } = kbench.instance;
  fakeClaude.script([
    {
      tool: {
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which database?",
              header: "Database",
              multiSelect: false,
              options: [
                { label: "Postgres", description: "Relational" },
                { label: "SQLite", description: "A file" },
              ],
            },
            {
              question: "Which extras?",
              header: "Extras",
              multiSelect: true,
              options: [
                { label: "Cache", description: "In memory" },
                { label: "Queue", description: "Background jobs" },
              ],
            },
          ],
        },
      },
      ask: true,
    },
    { text: "going with that" },
  ]);
  await app.agentInput("session 1").fill("set it up");
  await app.agentInput("session 1").press("Enter");

  for (const device of [app, otherDevice]) {
    const panel = device.questionPrompt("session 1");
    await expect(panel).toContainText("Which database?");
    await expect(panel.getByRole("button", { name: "1. Postgres" })).toBeVisible();
    await expect(device.agentInput("session 1")).toBeHidden();
  }

  const panel = otherDevice.questionPrompt("session 1");
  const submit = panel.getByRole("button", { name: "Submit" });
  await expect(submit).toBeDisabled();
  await panel.getByRole("button", { name: "2. SQLite" }).click();
  await panel.getByRole("button", { name: "1. Cache" }).click();
  await panel.getByRole("button", { name: "2. Queue" }).click();
  await expect(panel.getByRole("button", { name: "1. Cache" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(app.questionPrompt("session 1")).toHaveCount(0);
  await expect(otherDevice.questionPrompt("session 1")).toHaveCount(0);
  const log = app.agentRegion("session 1").getByRole("log");
  await expect(log).toContainText("going with that");
  await expect(log).toContainText("question: Which database? → SQLite");
  await expect(log).toContainText("Which extras? → Cache, Queue");
  const answered = fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_response" ? [entry.message.response.response] : [],
    );
  expect(answered).toMatchObject([
    {
      behavior: "allow",
      updatedInput: {
        answers: { "Which database?": "SQLite", "Which extras?": "Cache, Queue" },
      },
    },
  ]);
});

test("a single question is answered by choosing, or by the owner's own words", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  const question = {
    questions: [
      {
        question: "Which colour?",
        header: "Colour",
        multiSelect: false,
        options: [
          { label: "Red", description: "Warm" },
          { label: "Blue", description: "Cool" },
        ],
      },
    ],
  };
  fakeClaude.script([
    { tool: { name: "AskUserQuestion", input: question }, ask: true },
    { text: "red it is" },
  ]);
  fakeClaude.script([
    { tool: { name: "AskUserQuestion", input: question }, ask: true },
    { text: "teal it is" },
  ]);
  await app.agentInput("session 1").fill("pick");
  await app.agentInput("session 1").press("Enter");
  await app.questionPrompt("session 1").getByRole("button", { name: "1. Red" }).click();
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("red it is");

  await app.agentInput("session 1").fill("pick again");
  await app.agentInput("session 1").press("Enter");
  const panel = app.questionPrompt("session 1");
  await panel.getByRole("button", { name: "3. Other" }).click();
  await panel.getByRole("textbox", { name: /Your own answer/ }).fill("teal");
  await panel.getByRole("button", { name: "Submit" }).click();
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("teal it is");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "Which colour? → teal",
  );
});

test("a plan is shown as markdown; approving lets Claude carry on, and rejecting sends the feedback", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  const { fakeClaude } = kbench.instance;
  fakeClaude.script([
    {
      tool: {
        name: "ExitPlanMode",
        input: { plan: "## The plan\n\n- first step\n- second step" },
      },
      ask: true,
    },
    { text: "revising the plan" },
  ]);
  fakeClaude.script([
    {
      tool: { name: "ExitPlanMode", input: { plan: "## The plan\n\n- smaller step" } },
      ask: true,
    },
    { text: "carrying out the plan" },
  ]);
  await app.agentInput("session 1").fill("plan it");
  await app.agentInput("session 1").press("Enter");

  for (const device of [app, otherDevice]) {
    const panel = device.planPrompt("session 1");
    await expect(panel.getByRole("heading", { name: "The plan" })).toBeVisible();
    await expect(panel.getByRole("listitem")).toHaveText(["first step", "second step"]);
  }

  // Rejecting: the feedback goes to Claude, who plans again.
  const panel = app.planPrompt("session 1");
  await panel.getByRole("button", { name: "2. No, keep planning" }).click();
  await panel
    .getByRole("textbox", { name: "Tell Claude what to change in the plan" })
    .fill("smaller steps");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  const log = app.agentRegion("session 1").getByRole("log");
  await expect(log).toContainText("plan: rejected: smaller steps");
  await expect(log).toContainText("revising the plan");

  await app.agentInput("session 1").fill("try again");
  await app.agentInput("session 1").press("Enter");
  await expect(otherDevice.planPrompt("session 1")).toContainText("smaller step");
  await otherDevice
    .planPrompt("session 1")
    .getByRole("button", { name: "1. Yes, proceed with the plan" })
    .click();
  await expect(app.planPrompt("session 1")).toHaveCount(0);
  await expect(log).toContainText("carrying out the plan");
  await expect(log).toContainText("plan: approved");

  const answered = fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_response" ? [entry.message.response.response] : [],
    ) as { behavior?: string; message?: string }[];
  expect(answered.map((a) => a.behavior)).toEqual(["deny", "allow"]);
  expect(answered[0]?.message).toContain("smaller steps");
});
