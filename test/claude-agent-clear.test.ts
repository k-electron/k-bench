import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/shared/agent-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";

// `/clear` moves a Claude Agent to a new Claude conversation. The new conversation's ID is the
// `session_id` of the next `system/init`: the `new_conversation_id` of `conversation_reset` is
// a decoy (the fake sends a different one, as the real Claude Code does). A Restart must resume
// the conversation the owner was last in, on the same log.

/** How each start of the fake Claude Code named its conversation: `--session-id=` or `--resume=`. */
const conversationsStarted = (fakeClaude: FakeClaude) =>
  fakeClaude.received().flatMap((entry) => {
    if (entry.kind !== "start") return [];
    const arg = entry.argv.find((a) => /^--(session-id|resume)=/.test(a)) ?? "";
    const [flag, id] = arg.slice(2).split("=");
    return [{ flag, id }];
  });

/** The conversation k-bench has stored for the Session: what Open in terminal would resume. */
function storedConversation(dataDir: string, sessionId: string): unknown {
  const db = new DatabaseSync(join(dataDir, "k-bench.db"), { readOnly: true });
  try {
    return (
      db
        .prepare("SELECT conversation_id AS id FROM sessions WHERE id = ?")
        .get(sessionId) as { id: string } | undefined
    )?.id;
  } finally {
    db.close();
  }
}

/** The `session_id` of each `system/init` in the log, in order. */
const initIds = (entries: LogEntry[]) =>
  entries.flatMap((entry) =>
    entry.kind === "sdk" &&
    entry.message.type === "system" &&
    entry.message.subtype === "init"
      ? [entry.message.session_id as string]
      : [],
  );

describe("/clear in a Claude Agent", () => {
  it("is where a Restart resumes: the new conversation, not the old one, on the same log", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    // The server follows a running Agent's status while it reads the state, as any page does.
    await server.state();
    live.prompt("before");
    await live.waitForEntry(isResult, "the first answer");

    live.prompt("/clear");
    await live.waitForEntry(
      (e) => e.kind === "sdk" && e.message.type === "conversation_reset",
      "the reset",
    );
    instance.fakeClaude.script([{ text: "a fresh start" }]);
    live.prompt("after");
    await pollUntil(() => live.entries.filter(isResult).length === 3, {
      description: "the answer to the prompt after /clear",
    });
    const [first, second] = [...new Set(initIds(live.entries))];
    expect(second).not.toBe(first);
    expect(live.assistantTexts).toContain("a fresh start");
    // The server keeps it too, so that nothing else resumes the old one.
    await pollUntil(
      () => storedConversation(instance.config.dataDir, session.id) === second,
      { description: "the server to store the new conversation" },
    );

    await server.post(`/api/sessions/${session.id}/stop`);
    const restarted = await server.post(`/api/sessions/${session.id}/restart`);

    expect(restarted.status).toBe(200);
    // The fake refuses `--resume=` of a conversation it never saved, so a Restart that
    // found the old one or a wrong one would not even have started.
    expect(conversationsStarted(instance.fakeClaude)).toEqual([
      { flag: "session-id", id: first },
      { flag: "resume", id: second },
    ]);
    const again = await server.openAgent(session.id);
    await again.sync();
    again.prompt("still here");
    await pollUntil(() => again.entries.filter(isResult).length === 4, {
      description: "the answer after the Restart",
    });
    expect(again.entries.map((e) => e.seq)).toEqual(again.entries.map((_, i) => i + 1));
    expect(
      again.entries.filter(
        (e) => e.kind === "sdk" && e.message.type === "conversation_reset",
      ),
    ).toHaveLength(1);
  });

  it("with nothing said in the new conversation yet, restarts in it as a fresh one, which Claude Code never saved", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    live.prompt("before");
    await live.waitForEntry(isResult, "the first answer");
    live.prompt("/clear");
    await pollUntil(() => live.entries.filter(isResult).length === 2, {
      description: "the answer to /clear",
    });
    const [, cleared] = [...new Set(initIds(live.entries))];

    await server.post(`/api/sessions/${session.id}/stop`);
    const restarted = await server.post(`/api/sessions/${session.id}/restart`);

    expect(restarted.status).toBe(200);
    const starts = conversationsStarted(instance.fakeClaude);
    expect(starts.at(-1)).toEqual({ flag: "session-id", id: cleared });
  });
});
