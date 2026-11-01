import { describe, expect, it } from "vitest";
import { createTestInstance, type State } from "./harness/instance.ts";
import { killTmuxServer } from "./harness/tmux.ts";

function sessionsOf(state: State): Array<{ name: string; status: string }> {
  return state.workspaces.flatMap((w) =>
    w.sessions.map((s) => ({ name: s.name, status: s.status })),
  );
}

async function boot() {
  const instance = createTestInstance();
  const server = await instance.start();
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  const session = await server.createSession(workspace.id);
  return { instance, server, workspace, session };
}

describe("Events WebSocket", () => {
  it("sends the current state as soon as a client connects", async () => {
    const { server, session } = await boot();

    const events = await server.openEvents();

    const snapshot = await events.waitForSnapshot(() => true);
    expect(snapshot.workspaces[0]?.sessions).toMatchObject([
      { id: session.id, name: "session 1", status: "running" },
    ]);
  });

  it("pushes a snapshot when another client creates a Workspace and a Session", async () => {
    const { instance, server, workspace } = await boot();
    const first = await server.openEvents();
    await first.waitForSnapshot(() => true);
    const second = server;

    const other = await second.createWorkspace({ folder: instance.makeFolder("other") });
    await first.waitForSnapshot(
      (state) => state.workspaces.some((w) => w.name === "other"),
      "the new Workspace",
    );
    await second.createSession(workspace.id);
    await second.createSession(other.id);

    const snapshot = await first.waitForSnapshot(
      (state) => sessionsOf(state).length === 3,
      "all three Sessions",
    );
    expect(snapshot.workspaces.map((w) => [w.name, w.sessions.length])).toEqual([
      ["project", 2],
      ["other", 1],
    ]);
  });

  it("pushes a snapshot when another client renames a Session", async () => {
    const { server, session } = await boot();
    const events = await server.openEvents();
    await events.waitForSnapshot(() => true);

    await server.renameSession(session.id, "build");

    await events.waitForSnapshot(
      (state) => sessionsOf(state)[0]?.name === "build",
      "the renamed Session",
    );
  });

  it("pushes a snapshot when another client deletes a Session", async () => {
    const { server, session } = await boot();
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => sessionsOf(state).length === 1);

    await server.deleteSession(session.id);

    await events.waitForSnapshot(
      (state) => sessionsOf(state).length === 0,
      "a snapshot without the Session",
    );
  });

  it("pushes a snapshot showing the Session Stopped when its shell exits, with no client request", async () => {
    const { server, session } = await boot();
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => sessionsOf(state)[0]?.status === "running");
    const terminal = await server.openTerminal(session.id);

    terminal.run("exit");

    await events.waitForSnapshot(
      (state) => sessionsOf(state)[0]?.status === "stopped",
      "the Session to be Stopped",
    );
  });

  it("pushes a snapshot showing every Session Stopped when the tmux server dies", async () => {
    const { instance, server } = await boot();
    const events = await server.openEvents();
    await events.waitForSnapshot((state) => sessionsOf(state)[0]?.status === "running");

    killTmuxServer(instance.config.tmuxSocket);

    await events.waitForSnapshot(
      (state) => sessionsOf(state)[0]?.status === "stopped",
      "the Session to be Stopped",
    );
  });

  it("sends the same snapshots to every connected client", async () => {
    const { instance, server } = await boot();
    const a = await server.openEvents();
    const b = await server.openEvents();

    await server.createWorkspace({ folder: instance.makeFolder("other") });

    for (const client of [a, b]) {
      await client.waitForSnapshot((state) => state.workspaces.length === 2);
    }
  });
});

describe("Terminal WebSocket close codes", () => {
  it("closes an open terminal with the deleted code when its Session is deleted", async () => {
    const { server, session } = await boot();
    const terminal = await server.openTerminal(session.id);
    await terminal.waitForOutput(/\S/);

    await server.deleteSession(session.id);

    expect(await terminal.waitForClose()).toBe(4404);
  });

  it("closes every open terminal of a deleted Session", async () => {
    const { server, session } = await boot();
    const a = await server.openTerminal(session.id);
    const b = await server.openTerminal(session.id);
    await Promise.all([a.waitForOutput(/\S/), b.waitForOutput(/\S/)]);

    await server.deleteSession(session.id);

    expect([await a.waitForClose(), await b.waitForClose()]).toEqual([4404, 4404]);
  });

  it("closes an open terminal with the Stopped code when its shell exits", async () => {
    const { server, session } = await boot();
    const terminal = await server.openTerminal(session.id);

    terminal.run("exit");

    expect(await terminal.waitForClose()).toBe(4410);
  });
});
