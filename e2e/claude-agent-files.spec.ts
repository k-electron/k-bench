import { expect, test } from "./harness.ts";
import { makeRepository } from "./project-files.ts";

// Claude Code is the fake `claude`, the Agent Runtime the real one.

test("typing @ and part of a name lists the Workspace's files, picking one inserts its path, and the prompt reaches Claude as shown", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("project");
  makeRepository(folder, ["src/app.ts", "src/server/app-routes.ts", "README.md"]);
  await app.createWorkspace(folder);
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const input = app.agentInput("session 1");
  const conversation = region.getByRole("log");
  const picker = region.getByRole("listbox", { name: "Files" });

  // An earlier prompt, which the arrows must not recall while the picker is open.
  await input.fill("hello");
  await input.press("Enter");
  await expect(conversation).toContainText("fake claude heard: hello");

  await input.fill("look at @app");
  // Two files: `src/app.log` is git-ignored, so it is not offered.
  await expect(picker.getByRole("option")).toHaveCount(2);
  await expect(picker.getByRole("option").first()).toContainText("app.ts");
  await expect(picker.getByRole("option", { selected: true })).toContainText("app.ts");
  await input.press("ArrowDown");
  await expect(picker.getByRole("option", { selected: true })).toContainText(
    "app-routes.ts",
  );
  await input.press("ArrowUp");
  await expect(input).toHaveValue("look at @app");

  // Escape closes the picker and leaves the text alone.
  await input.fill("@app");
  await expect(picker).toBeVisible();
  await input.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(input).toHaveValue("@app");

  // Enter picks: the path after the @, and the owner carries on typing.
  await input.fill("look at @app");
  await expect(picker.getByRole("option")).toHaveCount(2);
  await input.press("Enter");
  await expect(input).toHaveValue("look at @src/app.ts ");
  await expect(picker).toHaveCount(0);
  await expect(conversation.getByRole("article", { name: "Your prompt" })).toHaveCount(1);
  await input.pressSequentially("please");
  await input.press("Enter");
  await expect(conversation).toContainText(
    "fake claude heard: look at @src/app.ts please",
  );
  expect(kbench.instance.fakeClaude.prompts().map((p) => p.content)).toContain(
    "look at @src/app.ts please",
  );

  // A tap picks too, and an @ in the middle of the text works from where the caret is.
  await input.fill("compare @READ and the rest");
  await input.press("Home");
  for (let i = 0; i < "compare @READ".length; i++) await input.press("ArrowRight");
  await picker.getByRole("option", { name: /README\.md/ }).click();
  await expect(input).toHaveValue("compare @README.md and the rest");

  // A finished word, or an @ inside a word, is only text: the picker goes.
  await input.fill("@app");
  await expect(picker).toBeVisible();
  await input.press("Space");
  await expect(picker).toHaveCount(0);
  await input.fill("@app");
  await expect(picker).toBeVisible();
  await input.press("Home");
  await input.pressSequentially("you");
  await input.press("End");
  await expect(input).toHaveValue("you@app");
  await expect(picker).toHaveCount(0);
});
