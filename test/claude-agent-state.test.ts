import { describe, expect, it } from "vitest";
import type { SessionState, Snapshot } from "../src/shared/state-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { EventsClient } from "./harness/events.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.

type Events = EventsClient<Snapshot>;

/**
 * Resolves with the Session's Claude Agent state once the events socket reports `state`: in
 * the snapshot it holds now (what is true now) or any that comes after.
 */
async function waitForState(
  events: Events,
  sessionId: string,
  state: "idle" | "working" | "waiting",
): Promise<NonNullable<SessionState["agent"]>> {
  const from = Math.max(0, events.snapshots.length - 1);
  return pollUntil(
    () =>
      events.snapshots
        .slice(from)
        .flatMap((s) => s.workspaces.flatMap((w) => w.sessions))
        .find((x) => x.id === sessionId && x.agent?.state === state)?.agent,
    { description: `the Agent to be ${state}` },
  );
}

describe("a Claude Agent's state on the events socket", () => {
  it("is Idle at rest, Working during a turn, Waiting for you while an ask is open, and Idle after the turn", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const events = await server.openEvents();
    const client = await server.openAgent(session.id);
    await client.sync();

    const idle = await waitForState(events, session.id, "idle");
    // The versions travel with the state, for the later tickets that compare them.
    expect(idle.claudeVersion).toBe(client.hello?.claudeVersion);
    expect(idle.runtimeBuildId).toBe(client.hello?.runtimeBuildId);

    fakeClaude.script([
      { text: ["Starting", { hold: "mid" }, " done"] },
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true, result: "a.txt" },
      { text: "listed" },
    ]);
    client.prompt("go");
    const working = await waitForState(events, session.id, "working");
    expect(working.turnStartedAt).toBeGreaterThan(0);

    fakeClaude.release("mid");
    const ask = await client.waitForAsk();
    const waiting = await waitForState(events, session.id, "waiting");
    // The turn's clock keeps its start through Waiting.
    expect(waiting.turnStartedAt).toBe(working.turnStartedAt);

    client.answer(ask.requestId, "allow");
    await client.waitForEntry(isResult, "the turn's result");
    const after = await waitForState(events, session.id, "idle");
    expect(after.turnStartedAt).toBeUndefined();
  });

  it.each([
    ["with", true],
    ["without", false],
  ])(
    "is Working, then Idle, for a turn nobody sent, %s Claude Code's session state messages",
    async (_name, sessionStateMessages) => {
      const { instance, server, workspace } = await boot();
      const { fakeClaude } = instance;
      fakeClaude.configure({ sessionStateMessages });
      const session = await server.createClaudeAgent(workspace.id);
      const events = await server.openEvents();
      await waitForState(events, session.id, "idle");
      const client = await server.openAgent(session.id);
      await client.sync();

      // `/loop` starts a turn by itself: no prompt from k-bench comes before it.
      fakeClaude.spontaneous([{ text: ["Checking", { hold: "loop" }, " done"] }]);
      await waitForState(events, session.id, "working");
      fakeClaude.release("loop");
      await client.waitForEntry(isResult, "the turn's result");
      await waitForState(events, session.id, "idle");
    },
  );

  it("is reported again after k-bench restarts, whatever the Agent was doing", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    fakeClaude.script([
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true },
      { text: ["Almost", { hold: "end" }, " done"] },
    ]);
    client.prompt("go");
    const ask = await client.waitForAsk();

    await server.stop();
    const restarted = await instance.start();
    const events = await restarted.openEvents();
    // The first snapshot of a new server already has it: no flash of Idle.
    await waitForState(events, session.id, "waiting");
    expect(events.snapshots[0]?.workspaces[0]?.sessions[0]?.agent?.state).toBe("waiting");

    const again = await restarted.openAgent(session.id);
    await again.sync();
    again.answer(ask.requestId, "allow");
    await waitForState(events, session.id, "working");
    fakeClaude.release("end");
    await again.waitForEntry(isResult, "the turn's result");
    await waitForState(events, session.id, "idle");
  });

  it("reports a Stopped Agent as stopped with no state, and a restarted one Idle again", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const events = await server.openEvents();
    await waitForState(events, session.id, "idle");

    const client = await server.openAgent(session.id);
    client.send({ type: "shutdown" });
    const stopped = await events.waitForSnapshot(
      (s) => s.workspaces[0]?.sessions[0]?.status === "stopped",
      "the Agent to be stopped",
    );
    expect(stopped.workspaces[0]?.sessions[0]?.agent).toBeUndefined();

    expect((await server.post(`/api/sessions/${session.id}/restart`)).status).toBe(200);
    await waitForState(events, session.id, "idle");
  });
});
