import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runtimeBuildId, runtimeFile } from "../src/agent/paths.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeReceived } from "./harness/fake-claude.ts";
import type { TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

// Updating k-bench under running Claude Agents (ADR-0007, ADR-0008). Claude Code is the fake
// `claude`; the Agent Runtime and the Agent SDK are the real ones, and a second build of the
// runtime is the same code under another build ID (`instance.runtimeVariant`).

/** What the fake Claude Code was started with, one entry per start. */
const starts = (received: FakeReceived[]) =>
  received.flatMap((entry) => (entry.kind === "start" ? [entry] : []));

/** The Session's `agent` state once the server has heard its runtime (its build ID is there). */
async function heardAgent(server: TestServer, sessionId: string) {
  return pollUntil(
    async () => {
      const state = await server.state();
      const session = state.workspaces
        .flatMap((workspace) => workspace.sessions)
        .find((candidate) => candidate.id === sessionId);
      return session?.agent?.runtimeBuildId ? session.agent : undefined;
    },
    { description: "the server to have heard the Agent's runtime" },
  );
}

/**
 * Sends a prompt on a fresh connection, which holds the whole log, and waits for the turn it
 * causes to end (the log's earlier turns have results of their own).
 */
async function ask(server: TestServer, sessionId: string, text: string) {
  const client = await server.openAgent(sessionId);
  await client.sync();
  const earlier = client.entries.filter(isResult).length;
  client.prompt(text);
  await pollUntil(() => client.entries.filter(isResult).length > earlier, {
    description: `the answer to ${text}`,
  });
  return client;
}

describe("updating k-bench under a running Claude Agent", () => {
  it("leaves it untouched, and shows no update, when the new build has the same runtime", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const before = await heardAgent(server, session.id);
    await ask(server, session.id, "one");

    await server.stop();
    const restarted = await instance.start();

    const after = await heardAgent(restarted, session.id);
    expect(after.runtimeBuildId).toBe(before.runtimeBuildId);
    expect(after.updateAvailable).toBeUndefined();
    // The same Claude Code carries on with the conversation: it was never started again.
    const client = await ask(restarted, session.id, "two");
    expect(client.assistantTexts).toContain("fake claude heard: two");
    expect(starts(instance.fakeClaude.received())).toHaveLength(1);
  });

  it("shows an update on every Agent when the runtime changed, lets them work on, and moves each to the new build only when restarted, deleting the old build once none runs it", async () => {
    const { instance, server, workspace } = await boot();
    const { dataDir } = instance.config;
    const first = await server.createClaudeAgent(workspace.id, { name: "first" });
    const second = await server.createClaudeAgent(workspace.id, { name: "second" });
    const { runtimeBuildId: oldBuild = "" } = await heardAgent(server, first.id);
    await ask(server, first.id, "before");
    const [conversation] = starts(instance.fakeClaude.received()).map(
      (start) => start.argv.find((arg) => arg.startsWith("--session-id="))?.split("=")[1],
    );
    expect(conversation).toBeTruthy();

    // k-bench is updated to a build whose runtime differs.
    await server.stop();
    const variant = instance.runtimeVariant("changed");
    const newBuild = runtimeBuildId(readFileSync(variant));
    expect(newBuild).not.toBe(oldBuild);
    const updated = await instance.start({ agentRuntimeFile: variant });

    for (const { id } of [first, second]) {
      const agent = await heardAgent(updated, id);
      expect(agent).toMatchObject({ runtimeBuildId: oldBuild, updateAvailable: true });
    }
    // They keep working on the old build, which is kept for them.
    const working = await ask(updated, first.id, "during");
    expect(working.hello?.runtimeBuildId).toBe(oldBuild);
    expect(existsSync(runtimeFile(dataDir, oldBuild))).toBe(true);
    expect(starts(instance.fakeClaude.received())).toHaveLength(2);

    // Restart moves the Agent to the new build and carries on its conversation.
    const restart = await updated.post(`/api/sessions/${first.id}/agent/restart`);
    expect(restart.status).toBe(200);
    const moved = await heardAgent(updated, first.id);
    expect(moved.runtimeBuildId).toBe(newBuild);
    expect(moved.updateAvailable).toBeUndefined();
    const carried = await ask(updated, first.id, "after");
    expect(carried.hello?.runtimeBuildId).toBe(newBuild);
    expect(carried.assistantTexts).toContain("fake claude heard: after");
    expect(carried.entries.flatMap((e) => (e.kind === "prompt" ? [e.text] : []))).toEqual(
      ["before", "during", "after"],
    );
    const resumed = starts(instance.fakeClaude.received()).find((start) =>
      start.argv.includes(`--resume=${conversation}`),
    );
    expect(resumed).toBeDefined();

    // The other Agent has not been moved or touched, and still runs the old build.
    expect(await heardAgent(updated, second.id)).toMatchObject({
      runtimeBuildId: oldBuild,
      updateAvailable: true,
    });
    await updated.state();
    expect(existsSync(runtimeFile(dataDir, oldBuild))).toBe(true);

    // Once nothing runs the old build, it is deleted; the build in use is not.
    expect((await updated.post(`/api/sessions/${second.id}/agent/restart`)).status).toBe(
      200,
    );
    await pollUntil(
      async () => {
        await updated.state();
        return !existsSync(runtimeFile(dataDir, oldBuild));
      },
      { description: "the old runtime build to be deleted" },
    );
    expect(existsSync(runtimeFile(dataDir, newBuild))).toBe(true);
  });

  it("restarts an Agent whose runtime speaks a protocol this k-bench does not, carrying on its conversation", async () => {
    const { instance, server, workspace } = await boot();
    // An Agent started by a k-bench that spoke another protocol number.
    await server.stop();
    const other = await instance.start({
      agentRuntimeFile: instance.runtimeVariant("other-protocol", { protocol: 99 }),
    });
    const session = await other.createClaudeAgent(workspace.id);
    const before = await ask(other, session.id, "before");
    expect(before.hello?.protocol).toBe(99);

    // k-bench is updated: its own runtime speaks the protocol it was built with.
    await other.stop();
    const updated = await instance.start();
    const running = await ask(updated, session.id, "still running");
    expect(running.hello?.protocol).toBe(99);

    const restart = await updated.post(`/api/sessions/${session.id}/agent/restart`);
    expect(restart.status).toBe(200);
    const after = await ask(updated, session.id, "after");
    expect(after.hello?.protocol).toBe(1);
    expect(after.assistantTexts).toContain("fake claude heard: after");
    expect(after.entries.flatMap((e) => (e.kind === "prompt" ? [e.text] : []))).toEqual([
      "before",
      "still running",
      "after",
    ]);
    const [first, second] = starts(instance.fakeClaude.received());
    const conversation = first?.argv
      .find((arg) => arg.startsWith("--session-id="))
      ?.split("=")[1];
    expect(second?.argv).toContain(`--resume=${conversation}`);
  });
});
