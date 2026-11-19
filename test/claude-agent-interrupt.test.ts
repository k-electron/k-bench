import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/shared/agent-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { pollUntil } from "./harness/poll.ts";

const mentions = (entry: LogEntry, text: string) =>
  entry.kind === "sdk" && JSON.stringify(entry.message).includes(text);

describe("interrupting a Claude Agent, and sending while it works", () => {
  it("stops the turn with its tool unanswered, then runs the messages sent meanwhile, in the order sent", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    fakeClaude.script([
      { text: "looking" },
      { tool: { name: "Bash", input: { command: "sleep 99" } }, hold: "never" },
    ]);
    const first = client.prompt("long job");
    await pollUntil(() => client.entries.some((e) => mentions(e, '"tool_use"')), {
      description: "the tool to start",
    });
    // Sent while the tool runs: they go straight to Claude Code, in the order sent.
    const second = client.prompt("then this");
    const third = client.prompt("and then this");
    await pollUntil(() => fakeClaude.prompts().length === 3, {
      description: "Claude Code to have all three",
    });
    expect(fakeClaude.prompts().map((p) => p.uuid)).toEqual([first, second, third]);

    client.interrupt();
    await pollUntil(() => client.entries.filter(isResult).length === 3, {
      description: "three turns' results",
    });

    const results = client.entries.flatMap((e) =>
      e.kind === "sdk" && e.message.type === "result" ? [e.message] : [],
    );
    // The turn that was running ended interrupted; the queued ones then ran, each answered.
    expect(results.map((r) => r.subtype)).toEqual([
      "error_during_execution",
      "success",
      "success",
    ]);
    expect(client.assistantTexts.slice(-2)).toEqual([
      "fake claude heard: then this",
      "fake claude heard: and then this",
    ]);
    // The interrupted turn says so, and its tool never got a result: that is what shows it red.
    const turn = client.entries.slice(
      0,
      client.entries.findIndex((e) => isResult(e)),
    );
    expect(turn.some((e) => mentions(e, "[Request interrupted by user]"))).toBe(true);
    expect(turn.some((e) => mentions(e, '"tool_result"'))).toBe(false);
  });

  it("is harmless when Claude is idle: the next prompt is answered as usual", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    client.interrupt();
    client.prompt("hello");
    await client.waitForEntry(isResult, "the turn's result");

    expect(client.assistantTexts).toEqual(["fake claude heard: hello"]);
  });
});
