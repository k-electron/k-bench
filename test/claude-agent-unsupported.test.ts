import { describe, expect, it } from "vitest";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones. How
// the Transcript shows what is declined is tested in a browser (e2e/claude-agent-unsupported.spec.ts).

describe("what a Claude Agent declines", () => {
  it("declines an MCP elicitation for the owner, tells Claude Code so, and keeps what was asked, with the turn carrying on", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    fakeClaude.script([
      { text: "Looking it up. " },
      { elicit: { serverName: "docs", message: "Which workspace should I use?" } },
      { text: "Done without it." },
    ]);
    client.prompt("find the docs");
    await client.waitForEntry(isResult, "the turn's result");

    // As Claude Code saw it: the SDK answered the elicitation with a decline.
    const requested = fakeClaude
      .received()
      .find((entry) => entry.kind === "control_response" && isDecline(entry.message));
    expect(requested).toBeDefined();

    // The Agent kept going, and the log says what was asked, at the place it happened.
    expect(client.assistantTexts).toContain("Done without it.");
    const kinds = client.entries.map((entry) =>
      entry.kind === "declined" ? "declined" : entry.kind,
    );
    const declined = client.entries.find((entry) => entry.kind === "declined");
    expect(declined).toMatchObject({
      what: "elicitation",
      request: { serverName: "docs", message: "Which workspace should I use?" },
    });
    expect(kinds.indexOf("declined")).toBeGreaterThan(kinds.indexOf("prompt"));

    // It is a log entry: a client that connects later sees it too.
    const late = await server.openAgent(session.id);
    await late.sync();
    await pollUntil(() => late.entries.find((entry) => entry.kind === "declined"), {
      description: "the declined entry in a later client's replay",
    });
  });
});

/** Whether a control response is the SDK's decline of an elicitation. */
function isDecline(message: { response: Record<string, unknown> }): boolean {
  const inner = message.response.response as { action?: string } | undefined;
  return inner?.action === "decline";
}
