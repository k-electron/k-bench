import { describe, expect, it } from "vitest";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { pollUntil } from "./harness/poll.ts";

// What the runtime tells every client for the Transcript's status line and header: how long the
// turn has run, how full Claude Code's context is, and the folder. The Transcript itself is
// tested in a browser (e2e/claude-agent-transcript.spec.ts).

const CONTEXT = {
  categories: [],
  totalTokens: 120000,
  maxTokens: 200000,
  percentage: 60,
  autoCompactThreshold: 160000,
  isAutoCompactEnabled: true,
};

describe("a Claude Agent's status", () => {
  it("says when the turn began while it works and how full the context is once Claude Code has said", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    fakeClaude.configure({ contextUsage: CONTEXT });
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);

    // Before any prompt: the folder is in the hello (Claude Code names it only per turn), and
    // the context is already known (it is polled at the start).
    const hello = await pollUntil(() => client.hello, { description: "the hello" });
    expect(hello.folder).toBe(workspace.folder);
    await pollUntil(() => client.status?.context, { description: "the context" });

    await client.sync();
    fakeClaude.script([{ text: ["working ", { hold: "gate" }, "on it"] }]);
    const before = Date.now();
    client.prompt("go");
    const working = await pollUntil(
      () => (client.status?.state === "working" ? client.status : undefined),
      { description: "a working status" },
    );
    expect(working.turnStartedAt).toBeGreaterThanOrEqual(before);
    expect(working.turnStartedAt).toBeLessThanOrEqual(Date.now());

    fakeClaude.release("gate");
    await client.waitForEntry(isResult, "the turn's result");
    const idle = await pollUntil(
      () => (client.status?.state === "idle" ? client.status : undefined),
      { description: "an idle status" },
    );
    expect(idle.turnStartedAt).toBeUndefined();
    expect(idle.context).toEqual({
      totalTokens: 120000,
      maxTokens: 200000,
      percentage: 60,
      autoCompactThreshold: 160000,
      isAutoCompactEnabled: true,
    });

    // A client that connects now is told the same without asking.
    const late = await server.openAgent(session.id);
    expect(
      await pollUntil(() => late.status?.context, { description: "its status" }),
    ).toEqual(idle.context);
  });

  it("carries on when Claude Code cannot report context usage", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    // An older Claude Code answers the request with "unsupported".
    fakeClaude.configure({ contextUsage: null });
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    client.prompt("first");
    await client.waitForEntry(isResult, "the first result");
    fakeClaude.script([{ text: "still here" }]);
    client.prompt("second");
    await pollUntil(() => client.assistantTexts.includes("still here"), {
      description: "the second reply",
    });

    expect(client.status?.context).toBeUndefined();
    expect(client.closeCode).toBeUndefined();
  });
});
