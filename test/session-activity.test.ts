import { describe, expect, it } from "vitest";
import { createTestInstance, type State } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

// A Claude Session is Working while Claude Code is in a turn and Idle once the turn ends.
// The fake Claude Code runs k-bench's hooks as Claude Code does: a message starts a turn and
// ends it once answered, and `think` starts one and holds it.

/**
 * Long enough that the state feed's poll never runs during a test, so a snapshot that
 * arrives was pushed when the state changed.
 */
const NO_POLL = { statePollMs: 600_000 };

async function boot(options = {}) {
  const instance = createTestInstance();
  const server = await instance.start(options);
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  return { instance, server, workspace };
}

function activityOf(state: State, sessionId: string) {
  return state.workspaces.flatMap((w) => w.sessions).find((s) => s.id === sessionId)
    ?.activity;
}

describe("A Claude Session's state", () => {
  it("is Idle when launched, Working in a turn and Idle once it is answered, each pushed at once", async () => {
    const { server, workspace } = await boot(NO_POLL);
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");
    const events = await server.openEvents();
    await events.waitForSnapshot(
      (state) => activityOf(state, claude.id) === "idle",
      "the launched Session Idle",
    );

    terminal.run("think");
    await events.waitForSnapshot(
      (state) => activityOf(state, claude.id) === "working",
      "the Session Working once a turn starts",
    );

    terminal.run("a message");
    await terminal.waitForOutput("claude-stub heard: a message");
    await events.waitForSnapshot(
      (state) => activityOf(state, claude.id) === "idle",
      "the Session Idle once its turn is answered",
    );
  });

  it("is Idle in a new conversation", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    terminal.run("think");
    await pollUntil(
      async () => activityOf(await server.state(), claude.id) === "working",
    );

    terminal.run("clear");

    await pollUntil(async () => activityOf(await server.state(), claude.id) === "idle", {
      description: "the Session Idle in its new conversation",
    });
  });

  it("is reported by hooks that add nothing to the Claude conversation", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);

    terminal.run("clear");
    terminal.run("a message");
    // The stub reports a hook's output before it answers the message it ran for.
    await terminal.waitForOutput("claude-stub heard: a message");

    expect(terminal.output).not.toContain("claude-stub context:");
  });

  it("is not reported for a shell or a Stopped Session", async () => {
    const { server, workspace } = await boot();
    const shell = await server.createSession(workspace.id);
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    terminal.run("think");
    await pollUntil(
      async () => activityOf(await server.state(), claude.id) === "working",
    );

    terminal.run("exit 0");
    await terminal.waitForEnded();

    const state = await server.state();
    expect(activityOf(state, claude.id)).toBeNull();
    expect(activityOf(state, shell.id)).toBeNull();
  });
});
