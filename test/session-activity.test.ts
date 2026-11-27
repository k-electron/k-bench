import { describe, expect, it } from "vitest";
import type { InstanceConfig } from "../src/server/config.ts";
import type { SessionActivity } from "../src/shared/state-protocol.ts";
import { createTestInstance, type State, type TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { attachedClientCount, typeIntoSession } from "./harness/tmux.ts";

// A Claude Session is Working while Claude Code is in a turn, Waiting while it asks the
// owner something, and Idle once the turn ends. The fake Claude Code runs k-bench's hooks as
// Claude Code does: a message starts a turn and ends it once answered, `think` starts one
// and holds it, and its other commands ask and answer (see fake-claude.sh).

/**
 * Long enough that the state feed's poll never runs during a test, so a snapshot that
 * arrives was pushed when the state changed.
 */
const NO_POLL = { statePollMs: 600_000 };

async function boot(options = {}, config: Partial<InstanceConfig> = {}) {
  const instance = createTestInstance(config);
  const server = await instance.start(options);
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  return { instance, server, workspace };
}

/** A quiet time short enough for a test, yet well over tmux's one-second activity clock. */
const QUICK_DECAY = { workingQuietMs: 2_000 };

/** Every state the Session is read in, read again and again, until `done`. */
async function activitiesUntil(
  server: TestServer,
  sessionId: string,
  done: () => boolean,
): Promise<Set<SessionActivity | null | undefined>> {
  const seen = new Set<SessionActivity | null | undefined>();
  await pollUntil(
    async () => {
      seen.add(activityOf(await server.state(), sessionId));
      return done();
    },
    { description: "the end of the reads" },
  );
  return seen;
}

function activityOf(state: State, sessionId: string) {
  return state.workspaces.flatMap((w) => w.sessions).find((s) => s.id === sessionId)
    ?.activity;
}

async function waitForActivity(
  server: TestServer,
  sessionId: string,
  activity: SessionActivity,
): Promise<void> {
  await pollUntil(async () => activityOf(await server.state(), sessionId) === activity, {
    description: `the Session ${activity}`,
  });
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

  it("is Waiting while Claude Code asks permission, even once viewed, and Working once answered", async () => {
    const { instance, server, workspace } = await boot();
    const socket = instance.config.tmuxSocket;
    const claude = await server.createClaudeSession(workspace.id);
    await waitForActivity(server, claude.id, "idle");
    // Typed with no terminal attached, so no key of the owner's answers the prompt.
    typeIntoSession(socket, claude.id, "think");
    await waitForActivity(server, claude.id, "working");

    typeIntoSession(socket, claude.id, "ask-permission");
    await waitForActivity(server, claude.id, "waiting");

    const terminal = await server.openTerminal(claude.id);
    await pollUntil(() => attachedClientCount(socket, claude.id) === 1);
    expect(activityOf(await server.state(), claude.id)).toBe("waiting");

    typeIntoSession(socket, claude.id, "answer");
    await waitForActivity(server, claude.id, "working");
    terminal.close();
  });

  it("is Waiting while Claude Code asks a question, and Working once the owner sends it a key", async () => {
    const { instance, server, workspace } = await boot();
    const socket = instance.config.tmuxSocket;
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");
    // Each line the stub prints says the hooks for it have run.
    typeIntoSession(socket, claude.id, "think");
    await terminal.waitForOutput("claude-stub thinking");
    // Another tool is running, which isn't a question.
    expect(activityOf(await server.state(), claude.id)).toBe("working");
    typeIntoSession(socket, claude.id, "ask-question");
    await terminal.waitForOutput("claude-stub asking a question");
    expect(activityOf(await server.state(), claude.id)).toBe("waiting");

    // The owner picks an option, which no hook reports when it denies the tool.
    terminal.type("1");

    await waitForActivity(server, claude.id, "working");
  });

  it("is unchanged by a subagent's tool use and finish", async () => {
    const { instance, server, workspace } = await boot();
    const socket = instance.config.tmuxSocket;
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");
    typeIntoSession(socket, claude.id, "think");
    typeIntoSession(socket, claude.id, "ask-permission");
    await terminal.waitForOutput("claude-stub asking permission");

    typeIntoSession(socket, claude.id, "subagent-stop");
    await terminal.waitForOutput("claude-stub subagent finished");

    expect(activityOf(await server.state(), claude.id)).toBe("waiting");
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

  it("stays Working while Claude Code keeps printing, and decays to Idle once it goes quiet", async () => {
    const { instance, server, workspace } = await boot({}, QUICK_DECAY);
    const socket = instance.config.tmuxSocket;
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    typeIntoSession(socket, claude.id, "think");
    await waitForActivity(server, claude.id, "working");

    // Prints for well past the quiet time, with the state read all the while.
    typeIntoSession(socket, claude.id, "print 6");
    const seen = await activitiesUntil(server, claude.id, () =>
      terminal.output.includes("claude-stub printed"),
    );
    expect(seen).toEqual(new Set(["working"]));

    await waitForActivity(server, claude.id, "idle");
  });

  it("stays Idle once decayed, when Claude Code prints again with no new turn", async () => {
    const { instance, server, workspace } = await boot({}, QUICK_DECAY);
    const socket = instance.config.tmuxSocket;
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    typeIntoSession(socket, claude.id, "think");
    await waitForActivity(server, claude.id, "working");
    // The owner interrupts the turn, which no hook reports.
    await waitForActivity(server, claude.id, "idle");

    // One of the redraws Claude Code makes now and then between turns.
    typeIntoSession(socket, claude.id, "print 1");
    const seen = await activitiesUntil(server, claude.id, () =>
      terminal.output.includes("claude-stub printed"),
    );

    expect(seen).toEqual(new Set(["idle"]));
    expect(activityOf(await server.state(), claude.id)).toBe("idle");
  });

  it("stays Waiting through a quiet spell", async () => {
    const { instance, server, workspace } = await boot({}, QUICK_DECAY);
    const socket = instance.config.tmuxSocket;
    const claude = await server.createClaudeSession(workspace.id);
    typeIntoSession(socket, claude.id, "think");
    typeIntoSession(socket, claude.id, "ask-permission");
    await waitForActivity(server, claude.id, "waiting");

    // Proving it never decays means reading it all through a spell longer than the quiet time.
    const spellEnds = Date.now() + 2 * QUICK_DECAY.workingQuietMs;
    const seen = await activitiesUntil(server, claude.id, () => Date.now() >= spellEnds);

    expect(seen).toEqual(new Set(["waiting"]));
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
