import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real `claude`.

test("a Claude Agent takes the Launch options of a Claude TUI, shares them with it in the dialog, and Focus view shows each tool call as one line", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);

  // The dialog's choices for Claude TUI carry over to Claude Agent: one set of options.
  await app.openNewSessionDialog("project");
  const dialog = app.newSessionDialog;
  await dialog.getByRole("radio", { name: "Claude TUI", exact: true }).check();
  await dialog.getByLabel("Model", { exact: true }).selectOption("sonnet");
  await dialog.getByRole("checkbox", { name: "Focus view" }).check();
  await dialog.getByRole("radio", { name: "Claude Agent (WIP)", exact: true }).check();
  await expect(dialog.getByLabel("Model", { exact: true })).toHaveValue("sonnet");
  await expect(dialog.getByRole("checkbox", { name: "Focus view" })).toBeChecked();
  await app.createInDialog({ effort: "High", advisor: "Opus" });
  await expect(dialog).toBeHidden();

  // The next dialog, on any device, opens on the Agent with what was chosen.
  await app.openNewSessionDialog("project");
  await expect(
    dialog.getByRole("radio", { name: "Claude Agent (WIP)", exact: true }),
  ).toBeChecked();
  await expect(dialog.getByLabel("Model", { exact: true })).toHaveValue("sonnet");
  await expect(dialog.getByLabel("Effort", { exact: true })).toHaveValue("high");
  await expect(dialog.getByLabel("Advisor", { exact: true })).toHaveValue("opus");
  await expect(dialog.getByRole("checkbox", { name: "Focus view" })).toBeChecked();
  await app.page.keyboard.press("Escape");

  // What was chosen reached Claude Code.
  const start = await fakeClaude.waitForReceived(
    (entry) => entry.kind === "start",
    "the fake's start",
  );
  expect(start.kind === "start" && start.argv).toEqual(
    expect.arrayContaining(["--model=sonnet", "--effort=high"]),
  );

  // In Focus view a tool call is one line: its name and target, and none of its output.
  const region = app.agentRegion("session 1");
  fakeClaude.script([
    {
      tool: { name: "Bash", input: { command: "ls -la" } },
      result: "file-1.txt\nfile-2.txt",
    },
    { text: "listed" },
  ]);
  await app.agentInput("session 1").fill("list the files");
  await app.agentInput("session 1").press("Enter");
  const ls = region.getByRole("article", { name: "Bash(ls -la)", exact: true });
  await expect(ls.getByRole("img", { name: "Done" })).toBeVisible();
  await expect(region.getByRole("log")).toContainText("listed");
  await expect(ls).not.toContainText("file-1.txt");
});
