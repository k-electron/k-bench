import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/shared/agent-protocol.ts";
import type { AgentClient } from "./harness/agent.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.

const QUESTIONS = [
  {
    question: "Which database?",
    header: "Database",
    multiSelect: false,
    options: [
      { label: "Postgres", description: "Relational" },
      { label: "SQLite", description: "A file" },
    ],
  },
  {
    question: "Which extras?",
    header: "Extras",
    multiSelect: true,
    options: [
      { label: "Cache", description: "In memory" },
      { label: "Queue", description: "Background jobs" },
    ],
  },
];

/** What the SDK sent Claude Code in answer to the asks, in order. */
const responses = (fakeClaude: FakeClaude) =>
  fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_response" ? [entry.message.response.response] : [],
    ) as {
    behavior?: string;
    message?: string;
    updatedInput?: Record<string, unknown>;
  }[];

const answersTo = (client: AgentClient, requestId: string) =>
  client.entries.filter(
    (entry): entry is Extract<LogEntry, { kind: "permission_answered" }> =>
      entry.kind === "permission_answered" && entry.requestId === requestId,
  );

describe("a Claude Agent's questions", () => {
  it("are answered by the first answer from any client, and Claude hears each question with the answer", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const first = await server.openAgent(session.id);
    const second = await server.openAgent(session.id);
    await first.sync();
    await second.sync();
    fakeClaude.script([
      { tool: { name: "AskUserQuestion", input: { questions: QUESTIONS } }, ask: true },
      { text: "going with that" },
    ]);

    first.prompt("set it up");
    const ask = await first.waitForAsk();
    expect((await second.waitForAsk()).requestId).toBe(ask.requestId);
    expect(ask).toMatchObject({ toolName: "AskUserQuestion" });

    // Not answers to these questions, and a bare Yes: nothing is answered, the ask stays.
    first.answer(ask.requestId, {
      decision: "allow",
      answers: { "Something else?": "x" },
    });
    first.answer(ask.requestId, {
      decision: "allow",
      answers: { "Which database?": "Postgres" },
    });
    first.answer(ask.requestId, "allow");
    first.sendRaw(
      JSON.stringify({
        type: "answer",
        requestId: ask.requestId,
        decision: "deny",
        answers: {},
      }),
    );
    await pollUntil(() => first.messages.some((m) => m.type === "error"), {
      description: "the refusal of an answer that is not one",
    });
    expect(second.openAsks).toHaveLength(1);

    // Both answer at once: whichever the runtime reads first wins.
    first.answer(ask.requestId, {
      decision: "allow",
      answers: { "Which database?": "Postgres", "Which extras?": "Cache, Queue" },
    });
    second.answer(ask.requestId, {
      decision: "allow",
      answers: { "Which database?": "SQLite", "Which extras?": "my own words" },
    });
    await first.waitForEntry(isResult, "the turn's result");
    await second.waitForEntry(isResult, "the turn's result");

    expect(answersTo(first, ask.requestId)).toHaveLength(1);
    expect(answersTo(second, ask.requestId)).toEqual(answersTo(first, ask.requestId));
    const [heard] = responses(fakeClaude);
    expect(responses(fakeClaude)).toHaveLength(1);
    expect(heard).toMatchObject({ behavior: "allow" });
    // What Claude hears is its own input plus the chosen answers, and what the log says.
    expect(heard?.updatedInput).toMatchObject({ questions: QUESTIONS });
    const logged = answersTo(first, ask.requestId)[0]?.answer;
    expect(logged).toMatchObject({ decision: "allow" });
    expect(heard?.updatedInput?.answers).toEqual(
      (logged as { answers: unknown }).answers,
    );
    expect(heard?.updatedInput?.answers).toMatchObject({
      "Which database?": expect.stringMatching(/^(Postgres|SQLite)$/),
    });
  });

  it("can be skipped, and Claude is told the owner declined", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    instance.fakeClaude.script([
      { tool: { name: "AskUserQuestion", input: { questions: QUESTIONS } }, ask: true },
      { text: "ok, without" },
    ]);
    client.prompt("set it up");
    const { requestId } = await client.waitForAsk();
    client.answer(requestId, "deny");
    await client.waitForEntry(isResult, "the turn's result");
    expect(responses(instance.fakeClaude)).toMatchObject([{ behavior: "deny" }]);
  });
});

describe("a Claude Agent's plan approval", () => {
  it("lets Claude carry on when approved, and the mode line leaves plan mode", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    client.setPermissionMode("plan");
    await pollUntil(() => client.mode === "plan", { description: "plan mode" });
    fakeClaude.script([
      {
        tool: {
          name: "ExitPlanMode",
          input: { plan: "## Plan\n\n1. Do the thing" },
        },
        ask: true,
      },
      { text: "doing the thing" },
    ]);

    client.prompt("plan it");
    const ask = await client.waitForAsk();
    expect(ask).toMatchObject({
      toolName: "ExitPlanMode",
      input: { plan: "## Plan\n\n1. Do the thing" },
    });
    client.answer(ask.requestId, "allow");
    await client.waitForEntry(isResult, "the turn's result");

    expect(responses(fakeClaude)).toMatchObject([{ behavior: "allow" }]);
    expect(client.assistantTexts).toContain("doing the thing");
    // Approving leaves plan mode, whether or not Claude Code says so itself.
    await pollUntil(() => client.mode === "default", {
      description: "the mode line to leave plan mode",
    });
  });

  it("sends the feedback to Claude when rejected, and the mode stays", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    client.setPermissionMode("plan");
    await pollUntil(() => client.mode === "plan", { description: "plan mode" });
    fakeClaude.script([
      {
        tool: { name: "ExitPlanMode", input: { plan: "Rewrite everything" } },
        ask: true,
      },
      { text: "revising" },
    ]);

    client.prompt("plan it");
    const { requestId } = await client.waitForAsk();
    client.answer(requestId, { decision: "deny", message: "smaller steps please" });
    await client.waitForEntry(isResult, "the turn's result");

    const [heard] = responses(fakeClaude);
    expect(heard).toMatchObject({ behavior: "deny" });
    expect(heard?.message).toContain("smaller steps please");
    expect(client.mode).toBe("plan");
  });
});
