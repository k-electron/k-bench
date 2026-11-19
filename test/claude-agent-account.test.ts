import { describe, expect, it } from "vitest";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`, whose `account` each test sets: nothing here touches a
// real login. The Agent Runtime and the Agent SDK are the real ones.

const SUBSCRIPTION = {
  email: "you@example.com",
  subscriptionType: "Claude Max",
  apiProvider: "firstParty",
};

const refusals = [
  {
    login: "an API key",
    account: { apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" },
    reason: /API key/,
  },
  {
    login: "another provider",
    account: { apiProvider: "bedrock" },
    reason: /bedrock/,
  },
  {
    login: "no subscription type",
    account: { email: "you@example.com", apiProvider: "firstParty" },
    reason: /no subscription type/,
  },
];

async function createRefused(server: TestServer, workspaceId: string) {
  const response = await server.post(`/api/workspaces/${workspaceId}/sessions`, {
    interface: "agent",
  });
  expect(response.status).toBe(422);
  return ((await response.json()) as { error: string }).error;
}

describe("a Claude Agent on a login that is not a Claude subscription", () => {
  it.each(refusals)(
    "is not started on $login: it says why, and no turn runs",
    async ({ account, reason }) => {
      const { instance, server, workspace } = await boot();
      instance.fakeClaude.configure({ account });

      const error = await createRefused(server, workspace.id);

      expect(error).toMatch(/^Claude Agent could not start: /);
      expect(error).toMatch(reason);
      expect(error).toMatch(/subscription/);
      expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
      expect(instance.fakeClaude.prompts()).toEqual([]);
    },
  );

  it("leaves an existing Agent Stopped with the reason when its login has changed, with no turn run, and runs again once the login is a subscription", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    fakeClaude.configure({ account: SUBSCRIPTION });
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    live.prompt("before");
    await live.waitForEntry(isResult, "the first answer");
    await server.post(`/api/sessions/${session.id}/stop`);

    fakeClaude.configure({
      account: { apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" },
    });
    const refused = await server.post(`/api/sessions/${session.id}/restart`);

    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toMatch(/API key/);
    expect((await server.state()).workspaces[0]?.sessions[0]?.status).toBe("stopped");
    const stopped = await server.openAgent(session.id);
    await stopped.sync();
    expect(
      await pollUntil(() => stopped.stoppedReason, { description: "a reason" }),
    ).toMatch(/API key.*subscription/);
    expect(fakeClaude.prompts().map((prompt) => prompt.content)).toEqual(["before"]);

    fakeClaude.configure({ account: SUBSCRIPTION });
    expect((await server.post(`/api/sessions/${session.id}/restart`)).status).toBe(200);
    const again = await server.openAgent(session.id);
    await again.sync();
    again.prompt("after");
    await pollUntil(() => again.entries.filter(isResult).length === 2, {
      description: "the answer once the login is a subscription",
    });
  });
});

describe("the claude version an Agent runs", () => {
  it("starts on an older claude and reports both versions, so the browser can warn", async () => {
    const { instance, server, workspace } = await boot();
    instance.fakeClaude.configure({ account: SUBSCRIPTION, version: "2.1.1" });
    const session = await server.createClaudeAgent(workspace.id);

    const client = await server.openAgent(session.id);
    const hello = await pollUntil(() => client.hello, { description: "the hello" });
    await client.sync();
    client.prompt("go");

    // Older than the Claude Code the SDK was made for, and it still runs a turn.
    expect(hello.claudeVersion).toBe("2.1.1");
    expect(hello.sdkClaudeCodeVersion).toMatch(/^2\.1\.\d+$/);
    await client.waitForEntry(isResult, "an answer from the older claude");
  });
});
