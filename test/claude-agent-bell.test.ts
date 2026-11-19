import { describe, expect, it } from "vitest";
import type { SessionState, Snapshot } from "../src/shared/state-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { EventsClient } from "./harness/events.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.
// A "device" here is a client of the agent socket that says what a Pane's page would: `view`.

type Events = EventsClient<Snapshot>;

const sessionIn = (snapshot: Snapshot, sessionId: string): SessionState | undefined =>
  snapshot.workspaces.flatMap((w) => w.sessions).find((s) => s.id === sessionId);

/** Resolves with the first snapshot, from `from` on, in which the Agent's row is as `matches` says. */
function waitForRow(
  events: Events,
  sessionId: string,
  description: string,
  matches: (session: SessionState) => boolean,
  from = 0,
): Promise<SessionState> {
  return pollUntil(
    () =>
      events.snapshots
        .slice(from)
        .map((snapshot) => sessionIn(snapshot, sessionId))
        .find((session) => session !== undefined && matches(session)),
    { description },
  );
}

/**
 * Runs a turn to its end, held mid-way so that its Working is seen: `start` begins it (a
 * prompt, or nothing for a turn the fake starts by itself). Resolves with the row as the
 * snapshot that first shows it Idle again has it, so a Bell raised with the turn ending can be
 * told from one that never was.
 */
async function runTurn(
  {
    fakeClaude,
    events,
    sessionId,
  }: { fakeClaude: FakeClaude; events: Events; sessionId: string },
  start: { prompt: () => void } | "spontaneous",
): Promise<SessionState> {
  const steps = [{ text: ["Working", { hold: "turn" }, " done"] }];
  const from = events.snapshots.length;
  if (start === "spontaneous") fakeClaude.spontaneous(steps);
  else {
    fakeClaude.script(steps);
    start.prompt();
  }
  await waitForRow(
    events,
    sessionId,
    "the turn to start",
    (s) => s.agent?.state === "working",
    from,
  );
  fakeClaude.release("turn");
  const working = events.snapshots.findIndex(
    (snapshot, i) =>
      i >= from && sessionIn(snapshot, sessionId)?.agent?.state === "working",
  );
  return waitForRow(
    events,
    sessionId,
    "the turn to end",
    (s) => s.agent?.state === "idle",
    working,
  );
}

describe("a Claude Agent's Bell", () => {
  it("rings when a turn ends while no visible page shows the Agent, however the turn began, and viewing on one device clears it on all", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const events = await server.openEvents();
    const desk = await server.openAgent(session.id);
    const phone = await server.openAgent(session.id);
    await desk.sync();
    // The desk has the Agent open in a background tab: that is not viewing.
    desk.view(false);
    const turn = { fakeClaude, events, sessionId: session.id };
    expect((await runTurn(turn, { prompt: () => desk.prompt("go") })).bell).toBe(true);

    // Looking at it on the phone clears the Bell on every device.
    phone.view(true);
    await waitForRow(events, session.id, "the Bell to clear", (s) => !s.bell);

    // While the phone shows it, a turn that ends raises nothing: the snapshot that shows the
    // Agent Idle already carries the Bell, if there were one.
    const seen = await runTurn(turn, { prompt: () => desk.prompt("again") });
    expect(seen.bell).toBe(false);

    // The phone goes away: a turn nobody sent (`/loop`) now ends unseen.
    phone.close();
    expect((await runTurn(turn, "spontaneous")).bell).toBe(true);
  });

  it("rings when an ask opens while nobody is viewing, and stays after the ask is answered until the Agent is viewed", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const events = await server.openEvents();
    const client = await server.openAgent(session.id);
    await client.sync();
    client.view(false);

    fakeClaude.script([
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true, result: "a.txt" },
      { text: "listed" },
    ]);
    client.prompt("go");
    const ask = await client.waitForAsk();
    const waiting = await waitForRow(
      events,
      session.id,
      "the Agent to wait with its Bell raised",
      (s) => s.agent?.state === "waiting",
    );
    expect(waiting.bell).toBe(true);

    client.answer(ask.requestId, "allow");
    await client.waitForEntry(isResult, "the turn's result");
    await waitForRow(
      events,
      session.id,
      "the Agent to be Idle",
      (s) => s.agent?.state === "idle",
    );
    expect(sessionIn(events.latest as Snapshot, session.id)?.bell).toBe(true);

    client.view(true);
    await waitForRow(events, session.id, "the Bell to clear", (s) => !s.bell);
  });

  it("is still raised after k-bench restarts", async () => {
    const { server, workspace, instance } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const events = await server.openEvents();
    const client = await server.openAgent(session.id);
    await client.sync();
    client.prompt("go");
    await waitForRow(events, session.id, "the Bell to be raised", (s) => s.bell);

    await server.stop();
    const restarted = await instance.start();
    const again = await restarted.openEvents();

    // The first snapshot of a new server already has it: no flash of a cleared Bell.
    await again.waitForSnapshot(() => true);
    expect(sessionIn(again.snapshots[0] as Snapshot, session.id)?.bell).toBe(true);
  });
});
