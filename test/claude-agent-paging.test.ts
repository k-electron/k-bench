import { describe, expect, it } from "vitest";
import type { AgentClient } from "./harness/agent.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; the Agent Runtime is the real one.

/** Sends `count` prompts, one turn at a time, and returns once the last turn has ended. */
async function runTurns(client: AgentClient, count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    const done = client.entries.filter(isResult).length + 1;
    client.prompt(`turn ${n}`);
    await pollUntil(() => client.entries.filter(isResult).length >= done, {
      description: `turn ${n} to end`,
    });
  }
}

/** The text of the prompts among entries, in order. */
const promptTexts = (entries: AgentClient["entries"]) =>
  entries.flatMap((entry) => (entry.kind === "prompt" ? [entry.text] : []));

describe("a long Claude Agent conversation", () => {
  it("opens on its latest turns and pages back to the start with no gap and no repeat", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const writer = await server.openAgent(session.id);
    await writer.sync();
    await runTurns(writer, 30);
    const whole = writer.entries;

    const reader = await server.openAgent(session.id);
    await reader.sync(0, { tailTurns: 4 });

    // Only the last four turns, from the first entry of the fourth-last.
    expect(promptTexts(reader.entries)).toEqual([
      "turn 27",
      "turn 28",
      "turn 29",
      "turn 30",
    ]);
    const from = reader.replayFrom ?? 0;
    expect(from).toBeGreaterThan(1);
    expect(reader.entries).toEqual(whole.filter((entry) => entry.seq >= from));

    // Scrolling back: each page ends where what is held begins, until the first entry.
    const older = [];
    let before = from;
    while (before > 1) {
      const page = await reader.page(before, 7);
      expect(page.from).toBeLessThan(before);
      expect(page.entries.every((entry) => entry.seq < before)).toBe(true);
      older.unshift(...page.entries);
      before = page.from;
    }
    expect([...older, ...reader.entries]).toEqual(whole);
    // Live entries carry on from the tail with nothing missing.
    writer.prompt("one more");
    await reader.waitForEntry(
      (entry) => entry.kind === "prompt" && entry.text === "one more",
      "the next prompt",
    );
    await reader.waitForEntry(isResult, "its result");
    const live = reader.entries.map((entry) => entry.seq);
    expect(live).toEqual(live.map((_, i) => from + i));
  });

  it("opens whole on a conversation shorter than the tail, and a client that holds entries is sent everything after them", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const writer = await server.openAgent(session.id);
    await writer.sync();
    await runTurns(writer, 3);

    const fresh = await server.openAgent(session.id);
    await fresh.sync(0, { tailTurns: 10 });
    expect(fresh.replayFrom).toBe(1);
    expect(fresh.entries).toEqual(writer.entries);

    // `tailTurns` is for a client that holds nothing: one that holds entries must get all
    // after them, or the conversation it shows would have a gap.
    const returning = await server.openAgent(session.id);
    await returning.sync(4, { tailTurns: 1 });
    expect(returning.entries).toEqual(writer.entries.slice(4));
  });

  it("keeps the turn in flight whole for a client that opens in the middle of it, queued prompt and all", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const writer = await server.openAgent(session.id);
    await writer.sync();
    await runTurns(writer, 3);
    fakeClaude.script([{ text: ["one ", "two ", { hold: "gate" }, "three"] }]);
    writer.prompt("slow one");
    await pollUntil(() => writer.fragments.includes("two "), {
      description: "the reply to stream",
    });
    // Sent while the reply streams: queued, logged now, and still part of this turn.
    writer.prompt("queued behind it");

    const reader = await server.openAgent(session.id);
    await reader.sync(0, { tailTurns: 1 });
    expect(promptTexts(reader.entries)).toEqual(["slow one", "queued behind it"]);
    expect(reader.snapshots.map((s) => s.blocks)).toEqual([
      [{ index: 0, type: "text", text: "one two " }],
    ]);
    fakeClaude.release("gate");
    await pollUntil(() => reader.entries.filter(isResult).length >= 1, {
      description: "the turn to end",
    });
    // The reply once, from the snapshot's text and the fragment after it.
    expect(reader.assistantTexts[0]).toBe("one two three");
    expect(reader.fragments[0]).toBe("three");
  });
});
