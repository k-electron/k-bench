import { expect, test } from "./harness.ts";

// Claude Code is the fake `claude`, the Agent Runtime the real one.

const COMMANDS = [
  {
    name: "compact",
    description: "Free up context by summarising the conversation",
    argumentHint: "[instructions]",
    builtin: true,
  },
  {
    name: "model",
    description: "Switch the model",
    argumentHint: "[name]",
    builtin: true,
  },
  { name: "exit", description: "Leave the terminal", argumentHint: "", builtin: true },
  { name: "review", description: "Review a pull request", argumentHint: "<number>" },
];

test("typing / lists Claude Code's commands with their hints, minus the terminal-only ones, and picking one inserts its name and stops", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  fakeClaude.configure({ commands: COMMANDS, terminalSlashCommands: ["exit"] });
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const input = app.agentInput("session 1");
  const conversation = region.getByRole("log");
  const menu = region.getByRole("listbox", { name: "Commands" });

  // A first message, so that Claude Code has said which commands belong to the terminal.
  await input.fill("hello");
  await input.press("Enter");
  await expect(conversation).toContainText("fake claude heard: hello");

  await input.fill("/");
  await expect(menu.getByRole("option")).toHaveCount(3);
  await expect(menu.getByRole("option", { name: /^\/compact/ })).toContainText(
    "[instructions]",
  );
  await expect(menu.getByRole("option", { name: /^\/compact/ })).toContainText(
    "Free up context by summarising the conversation",
  );
  await expect(menu.getByRole("option", { name: /^\/exit/ })).toHaveCount(0);

  // The arrows move through the menu: they do not recall the earlier prompt ("hello").
  await expect(menu.getByRole("option", { selected: true })).toContainText("/compact");
  await input.press("ArrowDown");
  await expect(menu.getByRole("option", { selected: true })).toContainText("/model");
  await input.press("ArrowUp");
  await input.press("ArrowUp");
  await expect(menu.getByRole("option", { selected: true })).toContainText("/review");
  await expect(input).toHaveValue("/");

  // Typing narrows it; Enter inserts the name and a space, and sends nothing.
  await input.fill("/mo");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(input).toHaveValue("/model ");
  await expect(menu).toHaveCount(0);
  await expect(conversation.getByRole("article", { name: "Your prompt" })).toHaveCount(1);

  // Escape closes the menu without leaving the box, and without interrupting anything.
  await input.fill("/");
  await expect(menu).toBeVisible();
  await input.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveValue("/");

  // A tap picks too (a phone has no Enter to reach for).
  await input.fill("/re");
  await menu.getByRole("option", { name: /^\/review/ }).click();
  await expect(input).toHaveValue("/review ");
  await expect(input).toBeFocused();
});

test("a typed command's reply shows in the conversation, and /model changes the header", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  fakeClaude.configure({ commands: COMMANDS });
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const input = app.agentInput("session 1");
  const conversation = region.getByRole("log");
  const header = region.getByRole("note", { name: "Claude Code" });

  await input.fill("hello");
  await input.press("Enter");
  await expect(conversation).toContainText("fake claude heard: hello");
  await expect(header).not.toContainText("fake-opus");

  // A command named in full is sent by Enter (the menu does not take the key).
  await input.fill("/model fake-opus");
  await input.press("Enter");
  await expect(
    conversation.getByRole("article", { name: "Command output" }),
  ).toContainText("Set model to fake-opus");
  await expect(header).toContainText("fake-opus");

  await input.fill("/compact");
  fakeClaude.script([
    {
      system: {
        subtype: "local_command_output",
        content: "Compacted\nfrom 90k to 12k tokens",
      },
    },
  ]);
  await input.press("Enter");
  await expect(
    conversation.getByRole("article", { name: "Command output" }).last(),
  ).toContainText("from 90k to 12k tokens");
  // Commands go to Claude Code as typed, like any prompt.
  expect(fakeClaude.prompts().map((p) => p.content)).toContain("/model fake-opus");
});
