import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.

/** The modes the SDK asked the fake to switch to, in order. */
const modesRequested = (fakeClaude: FakeClaude) =>
  fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_request" &&
      entry.message.request.subtype === "set_permission_mode"
        ? [entry.message.request.mode]
        : [],
    );

describe("a Claude Agent's permission mode", () => {
  it("is the one Claude Code reports, changes for every client when one asks for another, and is there for a client that connects later", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const first = await server.openAgent(session.id);
    const second = await server.openAgent(session.id);
    // Known from the start: no turn has run, so no `init` has said it yet.
    await pollUntil(() => first.mode === "default" && second.mode === "default", {
      description: "both clients to show the mode Claude Code started in",
    });

    first.setPermissionMode("acceptEdits");
    await pollUntil(() => first.mode === "acceptEdits" && second.mode === "acceptEdits", {
      description: "both clients to show Accept edits",
    });
    expect(modesRequested(instance.fakeClaude)).toEqual(["acceptEdits"]);

    const late = await server.openAgent(session.id);
    await pollUntil(() => late.mode === "acceptEdits", {
      description: "a client that connects later to show it too",
    });
  });

  it("follows a change Claude Code makes itself, such as leaving plan mode", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    const other = await server.openAgent(session.id);
    await client.sync();
    client.setPermissionMode("plan");
    await pollUntil(() => client.mode === "plan" && other.mode === "plan", {
      description: "plan mode",
    });

    instance.fakeClaude.script([{ text: "here is the plan" }, { mode: "default" }]);
    client.prompt("plan it");
    await pollUntil(() => client.mode === "default" && other.mode === "default", {
      description: "the mode Claude Code left plan mode for",
    });
    // Not something any client asked for: only the one it sent was requested.
    expect(modesRequested(instance.fakeClaude)).toEqual(["plan"]);
  });

  it("refuses a mode outside the Claude TUI's cycle, such as bypassing permissions", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);

    client.sendRaw(
      JSON.stringify({ type: "set_permission_mode", mode: "bypassPermissions" }),
    );
    await pollUntil(() => client.messages.some((m) => m.type === "error"), {
      description: "the refusal",
    });
    expect(modesRequested(instance.fakeClaude)).toEqual([]);
    expect(client.mode).toBe("default");
  });
});
