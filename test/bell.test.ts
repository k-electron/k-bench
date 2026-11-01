import { describe, expect, it } from "vitest";
import { createTestInstance, type State } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { echoCommand } from "./harness/terminal.ts";
import { typeIntoSession } from "./harness/tmux.ts";

const RING = "printf '\\a'";

async function boot() {
  const instance = createTestInstance();
  const server = await instance.start();
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
  it("is raised by a Session whose shell rings the bell with no terminal attached", async () => {
    const { server, session, other, socket } = await boot();
    expect(bellOf(await server.state(), session.id)).toBe(false);

    typeIntoSession(socket, session.id, RING);

    await pollUntil(async () => bellOf(await server.state(), session.id), {
      description: "the Session's Bell to be raised",
    });
    expect(bellOf(await server.state(), other.id)).toBe(false);
  });

  it("is pushed on the events socket", async () => {
    const { server, session, socket } = await boot();
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => bellOf(state, session.id) === false);

    typeIntoSession(socket, session.id, RING);

    await events.waitForSnapshot(
      (state) => bellOf(state, session.id) === true,
      "a snapshot with the Bell raised",
    );
  });

  it("survives a server restart", async () => {
    const { instance, server, session, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    await pollUntil(async () => bellOf(await server.state(), session.id));

    await server.stop();
    const restarted = await instance.start();

    expect(bellOf(await restarted.state(), session.id)).toBe(true);
  });

  it("is cleared by the seen endpoint, which leaves other Sessions' Bells alone", async () => {
    const { server, session, other, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    typeIntoSession(socket, other.id, RING);
    await pollUntil(async () => {
      const state = await server.state();
      return bellOf(state, session.id) && bellOf(state, other.id);
    });

    const response = await server.post(`/api/sessions/${session.id}/seen`);

    expect(response.status).toBe(204);
    const state = await server.state();
    expect(bellOf(state, session.id)).toBe(false);
    expect(bellOf(state, other.id)).toBe(true);
  });

  it("is pushed as cleared on the events socket after seen", async () => {
    const { server, session, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    await pollUntil(async () => bellOf(await server.state(), session.id));
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => bellOf(state, session.id) === true);

    await server.post(`/api/sessions/${session.id}/seen`);

    await events.waitForSnapshot((state) => bellOf(state, session.id) === false);
  });

  it("is raised again by a later bell after being cleared", async () => {
    const { server, session, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    await pollUntil(async () => bellOf(await server.state(), session.id));
    await server.post(`/api/sessions/${session.id}/seen`);
    expect(bellOf(await server.state(), session.id)).toBe(false);

    typeIntoSession(socket, session.id, RING);

    await pollUntil(async () => bellOf(await server.state(), session.id), {
      description: "the Bell to be raised again",
    });
  });

  it("is cleared by opening the Session's terminal, and the attach leaves nothing stale", async () => {
    const { server, session, socket } = await boot();
    typeIntoSession(socket, session.id, RING);
    await pollUntil(async () => bellOf(await server.state(), session.id));

    const terminal = await server.openTerminal(session.id);
    terminal.run(echoCommand("attached-6e1f"));
    await terminal.waitForOutput("attached-6e1f");

    await pollUntil(
      async () => (await bellOf(await server.state(), session.id)) === false,
      {
        description: "the Bell to be cleared by opening the terminal",
      },
    );
    terminal.close();
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

  it("answers 404 for seen on an unknown Session", async () => {
    const { server } = await boot();

    expect((await server.post("/api/sessions/nope/seen")).status).toBe(404);
  });
});
