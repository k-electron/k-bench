import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real
// `claude`, and the Agent Runtime is the real one. A second build of the runtime is the same
// code under another build ID (`instance.runtimeVariant`).

test("after k-bench is updated to another runtime a running Claude Agent says an update is available, keeps working, and Restart moves it on with its conversation", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const agent = app.agentRegion("session 1");
  const conversation = agent.getByRole("log");
  await app.agentInput("session 1").fill("before");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("fake claude heard: before");
  await expect(agent).not.toContainText("Update available");

  await kbench.stopServer();
  await kbench.startServer({
    agentRuntimeFile: kbench.instance.runtimeVariant("updated"),
  });
  await expect(agent).toContainText("Update available");
  // It is the owner's call: until then the Agent is as it was, and answers.
  await app.agentInput("session 1").fill("during");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("fake claude heard: during");
  await expect(agent).toContainText("Update available");

  await agent.getByRole("button", { name: "Restart" }).click();
  await expect(agent).not.toContainText("Update available");
  await expect(conversation).toContainText("before");
  await expect(conversation).toContainText("fake claude heard: during");
  await app.agentInput("session 1").fill("after");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("fake claude heard: after");
});

test("a Claude Agent whose runtime speaks a protocol this k-bench does not shows Restart in place of its conversation, and Restart brings the conversation back", async ({
  app,
  kbench,
}) => {
  // The Agent is started by a k-bench whose runtime speaks another protocol number.
  await kbench.stopServer();
  await kbench.startServer({
    agentRuntimeFile: kbench.instance.runtimeVariant("other-protocol", { protocol: 99 }),
  });
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const agent = app.agentRegion("session 1");
  await expect(agent).toContainText("can't be read by this one");
  await expect(app.agentInput("session 1")).toHaveCount(0);

  // It still holds a conversation, which a client that speaks its protocol can have.
  const client = await kbench.openAgent("session 1");
  await client.sync();
  client.prompt("before");
  await client.waitForEntry((entry) => entry.kind === "prompt", "the prompt");
  await expect(app.agentInput("session 1")).toHaveCount(0);

  await kbench.stopServer();
  await kbench.startServer();
  await expect(agent).toContainText("can't be read by this one");
  await agent.getByRole("button", { name: "Restart" }).click();

  const conversation = agent.getByRole("log");
  await expect(app.agentInput("session 1")).toBeVisible();
  await expect(agent).not.toContainText("can't be read by this one");
  await expect(conversation).toContainText("before");
  await expect(conversation).toContainText("fake claude heard: before");
  await app.agentInput("session 1").fill("after");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("fake claude heard: after");
});
