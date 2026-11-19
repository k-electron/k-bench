import { expect, test } from "./harness.ts";

// `/clear` in a Claude Agent: the Transcript shows where the conversation reset. Claude Code is
// the fake from test/harness/fake-claude.sh, which handles `/clear` as the real one does; what
// a Restart then resumes is in test/claude-agent-clear.test.ts.

test("a divider marks where /clear reset the conversation, and is still there after a reload", async ({
  app,
  page,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const conversation = region.getByRole("log");
  const input = app.agentInput("session 1");
  const divider = (scope: typeof region) =>
    scope.getByRole("article", { name: "Conversation cleared" });

  await input.fill("first");
  await input.press("Enter");
  await expect(conversation).toContainText("fake claude heard: first");
  await expect(divider(conversation)).toHaveCount(0);

  await input.fill("/clear");
  await input.press("Enter");
  await expect(divider(conversation)).toBeVisible();

  await input.fill("second");
  await input.press("Enter");
  await expect(conversation).toContainText("fake claude heard: second");
  await page.reload();
  // What was said before it stays above, in the one continuous Transcript.
  await expect(divider(app.agentRegion("session 1"))).toHaveCount(1);
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: first",
  );
});
