import { expect, test } from "./harness.ts";

// The controls used mid-turn. Claude Code is the fake `claude`, the Agent Runtime the real one.

test("Interrupt, by button or Esc, stops the turn; the next message is answered as usual", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  const region = app.agentRegion("session 1");
  const conversation = region.getByRole("log");
  const input = app.agentInput("session 1");
  const interrupt = region.getByRole("button", { name: "Interrupt" });
  // A tool that never finishes, twice.
  const stuck = [
    { text: "running it" },
    { tool: { name: "Bash", input: { command: "sleep 99" } }, hold: "never" },
  ];

  await expect(interrupt).toHaveCount(0);
  fakeClaude.script(stuck);
  await input.fill("first job");
  await input.press("Enter");
  await expect(conversation).toContainText("running it");
  await interrupt.click();
  await expect(conversation.getByText("Interrupted")).toHaveCount(1);
  // Claude is no longer working, so there is nothing to interrupt.
  await expect(interrupt).toHaveCount(0);

  fakeClaude.script(stuck);
  await input.fill("second job");
  await input.press("Enter");
  await expect(interrupt).toBeVisible();
  await input.press("Escape");
  await expect(conversation.getByText("Interrupted")).toHaveCount(2);
  await expect(interrupt).toHaveCount(0);

  await input.fill("third");
  await input.press("Enter");
  await expect(conversation).toContainText("fake claude heard: third");
});

test("a message sent while Claude works shows (queued) on every device until Claude picks it up", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  const conversation = app.agentRegion("session 1").getByRole("log");
  const input = app.agentInput("session 1");

  fakeClaude.script([{ text: ["one ", { hold: "gate" }, "two"] }]);
  await input.fill("first");
  await input.press("Enter");
  await expect(conversation).toContainText("one");
  await input.fill("second");
  await input.press("Enter");
  await input.fill("third");
  await input.press("Enter");

  await expect(conversation.getByText("second (queued)")).toBeVisible();
  await expect(conversation.getByText("third (queued)")).toBeVisible();
  // The first was picked up at once.
  await expect(conversation.getByText("first", { exact: true })).toBeVisible();
  await otherDevice.session("session 1").click();
  await expect(
    otherDevice.agentRegion("session 1").getByText("second (queued)"),
  ).toBeVisible();

  fakeClaude.release("gate");
  await expect(conversation).toContainText("fake claude heard: third");
  await expect(conversation.getByText("(queued)")).toHaveCount(0);
  await expect(otherDevice.agentRegion("session 1").getByText("(queued)")).toHaveCount(0);
  // In the order sent.
  expect(fakeClaude.prompts().map((p) => p.content)).toEqual([
    "first",
    "second",
    "third",
  ]);
  const text = (await conversation.textContent()) ?? "";
  expect(text.indexOf("heard: second")).toBeLessThan(text.indexOf("heard: third"));
});

test("Up and Down in an empty input step through earlier prompts, as on every device", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const conversation = app.agentRegion("session 1").getByRole("log");
  const input = app.agentInput("session 1");

  // Nothing to recall yet.
  await input.press("ArrowUp");
  await expect(input).toHaveValue("");
  for (const prompt of ["alpha", "beta"]) {
    await input.fill(prompt);
    await input.press("Enter");
    await expect(conversation).toContainText(`fake claude heard: ${prompt}`);
  }

  await input.press("ArrowUp");
  await expect(input).toHaveValue("beta");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("alpha");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("alpha");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("beta");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("");

  // Typed text is the owner's: Up does nothing to it.
  await input.fill("draft");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("draft");

  // The history comes from the conversation, so another device has the same.
  await otherDevice.session("session 1").click();
  const other = otherDevice.agentInput("session 1");
  await expect(otherDevice.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: beta",
  );
  await other.press("ArrowUp");
  await expect(other).toHaveValue("beta");
});
