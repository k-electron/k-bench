import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/shared/agent-protocol.ts";
import type { AgentClient } from "./harness/agent.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";
import { killTmuxServer } from "./harness/tmux.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.

/** What the fake was answered, per ask: what the SDK sent back to Claude Code. */
function answersReceived(fakeClaude: FakeClaude) {
  return fakeClaude.received().flatMap((entry) => {
    if (entry.kind !== "control_response") return [];
    const { request_id, response } = entry.message.response as {
      request_id?: string;
      response?: { behavior?: string };
    };
    return response?.behavior === undefined
      ? []
      : [{ requestId: request_id, behavior: response.behavior }];
  });
}

/** The `permission_answered` entries of a client, for one ask. */
const answersTo = (client: AgentClient, requestId: string) =>
  client.entries.filter(
    (entry): entry is Extract<LogEntry, { kind: "permission_answered" }> =>
      entry.kind === "permission_answered" && entry.requestId === requestId,
  );

/** The tool results Claude Code reported, in order: whether each was an error. */
const toolResultErrors = (client: AgentClient) =>
  client.entries.flatMap((entry) => {
    if (entry.kind !== "sdk" || entry.message.type !== "user") return [];
    const content = (entry.message.message as { content?: unknown }).content;
    return Array.isArray(content)
      ? content.flatMap((block: { type?: string; is_error?: boolean }) =>
          block.type === "tool_result" ? [block.is_error === true] : [],
        )
      : [];
  });

describe("a Claude Agent's permission asks", () => {
  it("shows an ask to every client, even one that connects after, and waits for it with nobody there; Allow lets the tool run and Deny denies it", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const first = await server.openAgent(session.id);
    const second = await server.openAgent(session.id);
    await first.sync();
    await second.sync();
    fakeClaude.script([
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true, result: "a.txt" },
      { text: "listed" },
    ]);
    fakeClaude.script([
      { tool: { name: "Bash", input: { command: "rm -rf x" } }, ask: true },
      { text: "not removed" },
    ]);

    first.prompt("what is here?");
    const ask = await first.waitForAsk();
    expect((await second.waitForAsk()).requestId).toBe(ask.requestId);
    expect(ask).toMatchObject({ toolName: "Bash", input: { command: "ls" } });

    // Nobody is connected for a while: the ask is still waiting, and a client that comes
    // later (a reloaded page) is shown it by its replay and can answer it.
    first.close();
    second.close();
    const late = await server.openAgent(session.id);
    await late.sync();
    expect(late.openAsks.map((open) => open.requestId)).toEqual([ask.requestId]);
    late.answer(ask.requestId, "allow");
    await late.waitForEntry(isResult, "the first turn's result");

    expect(answersReceived(fakeClaude)).toEqual([
      { requestId: ask.requestId, behavior: "allow" },
    ]);
    expect(toolResultErrors(late)).toEqual([false]);
    expect(late.openAsks).toEqual([]);

    late.prompt("and removing it?");
    const secondAsk = await pollUntil(() => late.openAsks[0], {
      description: "the second ask",
    });
    late.answer(secondAsk.requestId, "deny");
    await pollUntil(() => late.entries.filter(isResult).length === 2, {
      description: "the second turn's result",
    });

    expect(answersReceived(fakeClaude).map((a) => a.behavior)).toEqual(["allow", "deny"]);
    expect(toolResultErrors(late)).toEqual([false, true]);
    expect(late.assistantTexts).toEqual(["listed", "not removed"]);
  });

  it("takes the first answer and ignores the rest without an error, and every client sees how it ended", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const first = await server.openAgent(session.id);
    const second = await server.openAgent(session.id);
    await first.sync();
    await second.sync();
    fakeClaude.script([
      { tool: { name: "Write", input: { file_path: "a.txt" } }, ask: true },
      { text: "done" },
    ]);

    first.prompt("write it");
    const { requestId } = await first.waitForAsk();
    // Both answer at once: whichever the runtime reads first wins.
    first.answer(requestId, "allow");
    second.answer(requestId, "deny");
    await first.waitForEntry(isResult, "the turn's result");
    await second.waitForEntry(isResult, "the turn's result");

    expect(answersTo(first, requestId)).toHaveLength(1);
    expect(answersTo(second, requestId)).toEqual(answersTo(first, requestId));
    const decision = answersTo(first, requestId)[0]?.answer.decision;
    expect(["allow", "deny"]).toContain(decision);
    // Claude Code was told once, and what the log says.
    expect(answersReceived(fakeClaude)).toEqual([{ requestId, behavior: decision }]);

    // A late answer, and one for an ask that never was, are ignored: the next thing the
    // connection says is its own refusal of the garbage line, with nothing before it.
    second.answer(requestId, decision === "allow" ? "deny" : "allow");
    second.answer("no-such-ask", "allow");
    second.sendRaw("not json");
    await pollUntil(() => second.messages.some((m) => m.type === "error"), {
      description: "the refusal of the garbage line",
    });
    expect(second.messages.filter((m) => m.type === "error")).toMatchObject([
      { code: "bad_message" },
    ]);
    expect(answersTo(second, requestId)).toHaveLength(1);
    expect(answersReceived(fakeClaude)).toHaveLength(1);
  });

  it("does not let a client say what the tool's input or the saved rules are", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    instance.fakeClaude.script([
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true },
    ]);
    client.prompt("go");
    const { requestId } = await client.waitForAsk();

    client.sendRaw(
      JSON.stringify({
        type: "answer",
        requestId,
        decision: "allow",
        updatedInput: { command: "rm -rf /" },
        updatedPermissions: [{ type: "setMode", mode: "bypassPermissions" }],
      }),
    );
    await client.waitForEntry(isResult, "the turn's result");

    const response = instance.fakeClaude
      .received()
      .flatMap((entry) =>
        entry.kind === "control_response" ? [entry.message.response.response] : [],
      )
      .find((r) => (r as { behavior?: string } | undefined)?.behavior === "allow");
    expect(response).toMatchObject({
      behavior: "allow",
      updatedInput: { command: "ls" },
    });
    expect(JSON.stringify(response)).not.toContain("bypassPermissions");
  });

  it("closes an ask nobody can answer any more when the Agent comes back after its host went down", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    instance.fakeClaude.script([
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true },
    ]);
    client.prompt("go");
    const { requestId } = await client.waitForAsk();

    killTmuxServer(instance.config.tmuxSocket);
    await pollUntil(
      async () => (await server.state()).workspaces[0]?.sessions[0]?.status === "stopped",
      { description: "the Agent to be Stopped" },
    );
    await server.post(`/api/sessions/${session.id}/restart`);

    const again = await server.openAgent(session.id);
    await again.sync();
    // Its card must not come back: Claude Code that asked it is gone.
    expect(again.openAsks).toEqual([]);
    expect(answersTo(again, requestId)).toMatchObject([
      { answer: { decision: "interrupted" } },
    ]);
  });
});
