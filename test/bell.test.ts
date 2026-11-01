import { describe, expect, it } from "vitest";
import { createTestInstance, type State } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { echoCommand } from "./harness/terminal.ts";
import { attachedClientCount, typeIntoSession } from "./harness/tmux.ts";

const RING = "printf '\\a'";

/**
 * Long enough that the state feed's poll never runs during a test, so a snapshot that
 * arrives was pushed when the Bell changed.
 */
const NO_POLL = { statePollMs: 600_000 };

async function boot() {
  const instance = createTestInstance();
  const server = await instance.start(NO_POLL);
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  const session = await server.createSession(workspace.id);
  const other = await server.createSession(workspace.id);
  const socket = instance.config.tmuxSocket;
  return { instance, server, workspace, session, other, socket };
}

function bellOf(state: State, sessionId: string): boolean | undefined {
  return state.workspaces.flatMap((w) => w.sessions).find((s) => s.id === sessionId)
    ?.bell;
}

describe("Bell", () => {
  it("is raised by a Session that rings with nobody viewing it, and pushed at once", async () => {
    const { server, session, other, socket } = await boot();
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => bellOf(state, session.id) === false);

    typeIntoSession(socket, session.id, RING);

    const raised = await events.waitForSnapshot(
      (state) => bellOf(state, session.id) === true,
      "a snapshot with the Bell raised",
    );
    expect(bellOf(raised, other.id)).toBe(false);
  });

  it("survives a server restart", async () => {
    const { instance, server, session, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    await pollUntil(async () => bellOf(await server.state(), session.id));

    await server.stop();
    const restarted = await instance.start();

    expect(bellOf(await restarted.state(), session.id)).toBe(true);
  });

  it("is cleared by viewing the Session, and the clear is pushed to every device at once", async () => {
    const { server, session, other, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    typeIntoSession(socket, other.id, RING);
    await pollUntil(async () => {
      const state = await server.state();
      return bellOf(state, session.id) && bellOf(state, other.id);
    });
    // Another device, watching the sidebar. Its first snapshot has both Bells raised.
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => bellOf(state, session.id) === true);

    const terminal = await server.openTerminal(session.id);

    const cleared = await events.waitForSnapshot(
      (state) => bellOf(state, session.id) === false,
      "a snapshot with the viewed Session's Bell cleared",
    );
    expect(bellOf(cleared, other.id)).toBe(true);
    terminal.close();
  });

  it("is raised again by a bell after its viewer has left", async () => {
    const { server, session, socket } = await boot();
    const terminal = await server.openTerminal(session.id);
    terminal.run(echoCommand("viewing-5d0a"));
    await terminal.waitForOutput("viewing-5d0a");
    terminal.close();
    await pollUntil(() => attachedClientCount(socket, session.id) === 0, {
      description: "the viewer's tmux client to be gone",
    });
    const events = await server.openEvents();

    typeIntoSession(socket, session.id, RING);

    await events.waitForSnapshot(
      (state) => bellOf(state, session.id) === true,
      "a snapshot with the Bell raised",
    );
  });

  it("does not linger when it rings in a Session someone is viewing", async () => {
    const { server, session, other, socket } = await boot();
    const terminal = await server.openTerminal(session.id);
    terminal.run(`${RING}; ${echoCommand("rang-while-viewed-2b7c")}`);
    await terminal.waitForOutput("rang-while-viewed-2b7c");

    // A Bell in an unviewed Session is the sentinel: once it shows, the viewed Session's
    // bell has had time to show too.
    typeIntoSession(socket, other.id, RING);
    await pollUntil(async () => bellOf(await server.state(), other.id), {
      description: "the sentinel Bell",
    });
    expect(bellOf(await server.state(), session.id)).toBe(false);
  });
});
