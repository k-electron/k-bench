import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, which answers the Agent SDK's
// protocol with "fake claude heard: <prompt>": nothing here runs the real `claude`, and the
// Agent Runtime is the real one.

test("a Claude Agent shows the reply to a prompt typed in it, on every device", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");

  // A conversation, not a terminal; the row keeps the Claude spark.
  await expect(app.agentRegion("session 1")).toBeVisible();
  await expect(app.terminal("session 1")).toHaveCount(0);
  await expect(app.claudeGlyph("session 1")).toBeVisible();

  const input = app.agentInput("session 1");
  await input.pressSequentially("first line");
  // Shift+Enter starts a new line and sends nothing; Enter sends.
  await input.press("Shift+Enter");
  await input.pressSequentially("second line");
  await expect(input).toHaveValue("first line\nsecond line");
  await input.press("Enter");

  const conversation = app.agentRegion("session 1").getByRole("log");
  await expect(conversation).toContainText("fake claude heard: first line second line");
  await expect(input).toHaveValue("");

  // The same conversation, as it already is, on another device.
  await otherDevice.session("session 1").click();
  await expect(otherDevice.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: first line second line",
  );
});

test("a Claude Agent works in either Pane beside a shell", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project", "shell");
  await app.showTwoPanes();
  await app.createClaudeAgent("project", { name: "agent" });
  // Not through the row menu: closing it hands the focus back to its button a moment later,
  // which would take the keystrokes meant for the shell.
  await app.session("shell").click({ modifiers: ["Meta"] });

  await expect(
    app.pane(1).getByRole("region", { name: "Claude Agent agent" }),
  ).toBeVisible();
  await expect(app.terminalIn(2, "shell")).toBeVisible();
  await app.runMarker(app.terminalIn(2, "shell"), "kb-shell-beside-agent-77");
  await app.agentInput("agent").fill("hello");
  await app.agentInput("agent").press("Enter");
  await expect(app.agentRegion("agent").getByRole("log")).toContainText(
    "fake claude heard: hello",
  );
});

test("deleting a Claude Agent's Session removes it", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await expect(app.agentRegion("session 1")).toBeVisible();

  await app.sessionMenu("session 1", "Delete");
  await app.page
    .getByRole("alertdialog", { name: "Delete session 1?" })
    .getByRole("button", { name: "Delete session" })
    .click();

  await expect(app.session("session 1")).toHaveCount(0);
  await expect(app.agentRegion("session 1")).toHaveCount(0);
});

test("reloading the page mid-turn shows the whole conversation so far and the rest of the reply", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  fakeClaude.script([{ text: ["one ", "two ", { hold: "gate" }, "three"] }]);
  const conversation = app.agentRegion("session 1").getByRole("log");
  await app.agentInput("session 1").fill("tell me a story");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("one two");

  await app.page.reload();

  // The prompt, and the reply so far, from the page's first moment.
  await expect(conversation).toContainText("tell me a story");
  await expect(conversation).toContainText("one two");
  fakeClaude.release("gate");
  await expect(conversation).toContainText("one two three");
  // Once, not once from the snapshot and again from the finished message.
  await expect(conversation.getByText("one two three")).toHaveCount(1);
});

test("restarting k-bench mid-turn leaves the Claude Agent working, and the page carries on without a reload", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  fakeClaude.script([{ text: ["one ", "two ", { hold: "gate" }, "three"] }]);
  const conversation = app.agentRegion("session 1").getByRole("log");
  await app.agentInput("session 1").fill("tell me a story");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("one two");

  await kbench.stopServer();
  await expect(app.agentRegion("session 1").getByText("Reconnecting…")).toBeVisible();
  // Claude carries on with no k-bench running.
  fakeClaude.release("gate");
  await kbench.startServer();

  await expect(conversation).toContainText("one two three");
  await expect(conversation.getByText("one two three")).toHaveCount(1);
  await expect(app.agentRegion("session 1").getByText("Reconnecting…")).toHaveCount(0);
  // And it can be talked to again.
  await app.agentInput("session 1").fill("thanks");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("fake claude heard: thanks");
});
