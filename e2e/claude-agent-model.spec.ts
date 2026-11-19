import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, whose model list is recorded from a
// real Claude Code; nothing here runs the real `claude`.

test("the status line names the model a Claude Agent is on: the launched one from the start, then whatever Claude Code reports", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  // Launched on a model: named by Claude Code's own name for it before any prompt.
  await app.createClaudeAgent("project", { name: "chosen", model: "sonnet" });
  const chosen = app.agentRegion("chosen");
  await expect(chosen.getByRole("note", { name: "Model" })).toHaveText("Sonnet 5.5");

  // Launched on Default: which model that is, only Claude Code knows, and it says so when a
  // turn starts.
  await app.createClaudeAgent("project", { name: "default", model: "default" });
  const region = app.agentRegion("default");
  const input = app.agentInput("default");
  await expect(region.getByRole("note", { name: "Claude Code" })).toBeVisible();
  await expect(region.getByRole("note", { name: "Model" })).toHaveCount(0);
  await input.fill("hello");
  await input.press("Enter");
  await expect(region.getByRole("log")).toContainText("fake claude heard: hello");
  await expect(region.getByRole("note", { name: "Model" })).toHaveText("Haiku 5.5");

  // A model Claude Code reports later is followed.
  await input.fill("/model opus");
  await input.press("Enter");
  await input.fill("again");
  await input.press("Enter");
  await expect(region.getByRole("log")).toContainText("fake claude heard: again");
  await expect(region.getByRole("note", { name: "Model" })).toHaveText("Opus 5.5");

  // One Claude Code does not list is shown by its ID.
  await input.fill("/model claude-unlisted-1");
  await input.press("Enter");
  await input.fill("once more");
  await input.press("Enter");
  await expect(region.getByRole("log")).toContainText("fake claude heard: once more");
  await expect(region.getByRole("note", { name: "Model" })).toHaveText(
    "claude-unlisted-1",
  );
});
