import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("Session names", () => {
  it("names Sessions created without a name 'session N', using the next free N", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });

    const first = await server.createSession(workspace.id);
    const second = await server.createSession(workspace.id);
    const third = await server.createSession(workspace.id);
    expect([first.name, second.name, third.name]).toEqual([
      "session 1",
      "session 2",
      "session 3",
    ]);

    // A freed number is the next free one; a renamed Session no longer holds its number.
    await server.deleteSession(second.id);
    expect((await server.createSession(workspace.id)).name).toBe("session 2");
    await server.renameSession(first.id, "build");
    expect((await server.createSession(workspace.id)).name).toBe("session 1");
  });

  it("numbers Sessions per Workspace", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const a = await server.createWorkspace({ folder: instance.makeFolder("a") });
    const b = await server.createWorkspace({ folder: instance.makeFolder("b") });

    await server.createSession(a.id);
    await server.createSession(a.id);

    expect((await server.createSession(b.id)).name).toBe("session 1");
  });

  it("lists a Workspace's Sessions in creation order, whatever their names", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const zebra = await server.createSession(workspace.id, "zebra");
    const apple = await server.createSession(workspace.id, "apple");
    const mango = await server.createSession(workspace.id, "mango");

    await server.renameSession(zebra.id, "yak");

    const state = await server.state();
    expect(state.workspaces[0]?.sessions.map((s) => s.id)).toEqual([
      zebra.id,
      apple.id,
      mango.id,
    ]);
    expect(state.workspaces[0]?.sessions.map((s) => s.name)).toEqual([
      "yak",
      "apple",
      "mango",
    ]);
  });

  it("renames a Session, and the new name shows in state", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const session = await server.createSession(workspace.id);

    const response = await server.renameSession(session.id, "  deploy  ");

    expect(response.status).toBe(200);
    const state = await server.state();
    expect(state.workspaces[0]?.sessions).toMatchObject([
      { id: session.id, name: "deploy", status: "running" },
    ]);
  });

  it("refuses to rename onto a name taken in the same Workspace with 409", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const first = await server.createSession(workspace.id);
    const second = await server.createSession(workspace.id);

    const response = await server.renameSession(second.id, first.name);

    expect(response.status).toBe(409);
    const names = (await server.state()).workspaces[0]?.sessions.map((s) => s.name);
    expect(names).toEqual(["session 1", "session 2"]);
  });

  it("refuses to create a Session with a name taken in the Workspace with 409", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    await server.createSession(workspace.id, "build");

    const response = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      name: "build",
    });

    expect(response.status).toBe(409);
    expect((await server.state()).workspaces[0]?.sessions).toHaveLength(1);
  });

  it("allows the same name in a different Workspace", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const a = await server.createWorkspace({ folder: instance.makeFolder("a") });
    const b = await server.createWorkspace({ folder: instance.makeFolder("b") });
    await server.createSession(a.id, "shared");
    const other = await server.createSession(b.id);

    const response = await server.renameSession(other.id, "shared");

    expect(response.status).toBe(200);
  });

  it("accepts renaming a Session to the name it already has", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const session = await server.createSession(workspace.id);

    expect((await server.renameSession(session.id, session.name)).status).toBe(200);
  });

  it("rejects an empty name with 422 and an unknown Session with 404", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const session = await server.createSession(workspace.id);

    expect((await server.renameSession(session.id, "   ")).status).toBe(422);
    expect((await server.renameSession("no-such-session", "x")).status).toBe(404);
    expect((await server.state()).workspaces[0]?.sessions[0]?.name).toBe("session 1");
  });

  it("renames a Stopped Session", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const session = await server.createSession(workspace.id);
    const terminal = await server.openTerminal(session.id);
    terminal.run("exit");
    await pollUntil(
      async () => (await server.state()).workspaces[0]?.sessions[0]?.status === "stopped",
      { description: "the Session to be Stopped" },
    );

    expect((await server.renameSession(session.id, "old")).status).toBe(200);
    expect((await server.state()).workspaces[0]?.sessions[0]).toMatchObject({
      name: "old",
      status: "stopped",
    });
  });
});

describe("Deleting a Session", () => {
  it("ends its shell and everything running in it, and removes it from state", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("project");
    const workspace = await server.createWorkspace({ folder });
    const session = await server.createSession(workspace.id);
    const pidFile = join(folder, "pid");

    // A foreground process the shell is waiting on; it records its own pid.
    const terminal = await server.openTerminal(session.id);
    terminal.run(`sh -c 'echo $$ > pid; exec sleep 600'`);
    const pid = await pollUntil(
      () => {
        if (!existsSync(pidFile)) return undefined;
        const value = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
        return Number.isNaN(value) ? undefined : value;
      },
      { description: "the process to record its pid" },
    );
    expect(isAlive(pid)).toBe(true);

    const response = await server.deleteSession(session.id);

    expect(response.status).toBe(204);
    await pollUntil(() => !isAlive(pid), { description: "the process to end" });
    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
    expect((await server.deleteSession(session.id)).status).toBe(404);
  });

  it("deletes a Stopped Session", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const session = await server.createSession(workspace.id);
    const terminal = await server.openTerminal(session.id);
    terminal.run("exit");
    await pollUntil(
      async () => (await server.state()).workspaces[0]?.sessions[0]?.status === "stopped",
      { description: "the Session to be Stopped" },
    );

    expect((await server.deleteSession(session.id)).status).toBe(204);
    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
  });

  it("leaves the Workspace's other Sessions running", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const doomed = await server.createSession(workspace.id);
    const kept = await server.createSession(workspace.id);

    await server.deleteSession(doomed.id);

    expect((await server.state()).workspaces[0]?.sessions).toMatchObject([
      { id: kept.id, status: "running" },
    ]);
  });
});
