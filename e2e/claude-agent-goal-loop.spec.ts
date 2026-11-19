import { expect, test } from "./harness.ts";

// `/goal` and `/loop` in the Transcript. Claude Code is the fake from test/harness/fake-claude.sh,
// scripted with the messages the live check saw a real one send (docs/claude-agent-parity.md):
// `/goal` is a synthetic "Goal set" line, then re-prompts as user messages that start "Stop hook
// feedback:", all inside one turn; `/loop` is a turn that starts by itself later.

const goalSet = (condition: string) => ({
  raw: {
    type: "assistant",
    message: {
      model: "<synthetic>",
      role: "assistant",
      content: [{ type: "text", text: `Goal set: ${condition}` }],
    },
    parent_tool_use_id: null,
  },
});

const stopHookFeedback = (reason: string, flags: Record<string, boolean> = {}) => ({
  raw: {
    type: "user",
    message: { role: "user", content: `Stop hook feedback:\n${reason}` },
    parent_tool_use_id: null,
    ...flags,
  },
});

test("/goal shows its Goal set line, and its Stop hook feedback re-prompts as goal check-ins, not as your prompts", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const conversation = app.agentRegion("session 1").getByRole("log");

  kbench.instance.fakeClaude.script([
    goalSet("count.txt has three lines"),
    { text: "Added line 1." },
    // Whatever flags Claude Code puts on the re-prompt, it is not something the owner typed.
    stopHookFeedback("count.txt has one line of three", { isReplay: true }),
    { text: "Added line 2." },
    stopHookFeedback("count.txt has two lines of three", { isSynthetic: true }),
    { text: "Added line 3." },
  ]);
  await app.agentInput("session 1").fill("/goal count.txt has three lines");
  await app.agentInput("session 1").press("Enter");

  await expect(conversation.getByRole("article", { name: "Goal set" })).toContainText(
    "count.txt has three lines",
  );
  const checkIns = conversation.getByRole("article", { name: "Goal check-in" });
  await expect(checkIns).toHaveCount(2);
  await expect(checkIns.first()).toContainText("count.txt has one line of three");
  await expect(checkIns.first()).not.toContainText("Stop hook feedback");
  await expect(conversation).toContainText("Added line 3.");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  // The only prompt is the `/goal` the owner typed.
  await expect(conversation.getByRole("article", { name: "Your prompt" })).toHaveCount(1);
});

test("a turn /loop starts by itself shows in the Transcript, is Working, and raises the Bell when it ends while nobody views the Agent", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const conversation = app.agentRegion("session 1").getByRole("log");
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();

  await app.setPageVisible(false);
  kbench.instance.fakeClaude.spontaneous([
    { text: ["Checking the build", { hold: "loop" }, " again"] },
  ]);
  await expect(app.sessionStatus("session 1", "working")).toBeVisible();
  kbench.instance.fakeClaude.release("loop");
  await expect(app.rowPulse("session 1")).toBeVisible();

  await app.setPageVisible(true);
  await expect(conversation).toContainText("Checking the build again");
  // Nobody sent it: no prompt of the owner's comes with it.
  await expect(conversation.getByRole("article", { name: "Your prompt" })).toHaveCount(0);
});
