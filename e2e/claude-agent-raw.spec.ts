import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh: nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("a message's raw JSON is exactly what Claude Code sent, and the Raw switch shows the whole Transcript as JSON and back", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    { text: "all done" },
    { raw: { type: "mystery_kind", payload: { n: 42, nested: ["a", { b: null }] } } },
  ]);
  await app.agentInput("session 1").fill("hello there");
  await app.agentInput("session 1").press("Enter");

  const region = app.agentRegion("session 1");
  const conversation = region.getByRole("log");
  await expect(conversation).toContainText("all done");

  // `</>` on the reply shows the SDK message, not k-bench's log record around it.
  await conversation.getByText("all done").hover();
  await conversation.getByRole("button", { name: "Show raw message" }).last().click();
  const raw = conversation.getByLabel("Raw message", { exact: true });
  await expect(raw).toBeVisible();
  const message = JSON.parse((await raw.textContent()) ?? "");
  expect(message).toMatchObject({
    type: "assistant",
    message: { content: [{ type: "text", text: "all done" }] },
  });
  expect(message).not.toHaveProperty("seq");
  expect(message).not.toHaveProperty("kind");

  // Again hides it.
  await conversation.getByRole("button", { name: "Hide raw message" }).click();
  await expect(raw).toHaveCount(0);

  // The switch turns the Transcript into JSON, including what the conversation has no row for.
  await region.getByRole("checkbox", { name: "Raw" }).check();
  const mystery = conversation
    .getByLabel(/^Raw message \d+$/)
    .filter({ hasText: "mystery_kind" });
  await expect(mystery).toBeVisible();
  expect(JSON.parse((await mystery.textContent()) ?? "")).toMatchObject({
    type: "mystery_kind",
    payload: { n: 42, nested: ["a", { b: null }] },
  });
  await expect(conversation.getByRole("button", { name: /raw message/i })).toHaveCount(0);

  // And back to the conversation.
  await region.getByRole("checkbox", { name: "Raw" }).uncheck();
  await expect(mystery).toHaveCount(0);
  await expect(conversation.getByText("hello there")).toBeVisible();
  await expect(conversation.getByText("all done")).toBeVisible();
});
