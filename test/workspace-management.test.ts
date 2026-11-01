import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { echoCommand } from "./harness/terminal.ts";

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

describe("Renaming a Workspace", () => {
  it("shows the new name in the state, trimmed, and keeps the Workspace's Sessions", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("app"),
    });
    const session = await server.createSession(workspace.id);

    const response = await server.patch(`/api/workspaces/${workspace.id}`, {
      name: "  Billing  ",
    });

    expect(response.status).toBe(200);
    expect((await server.state()).workspaces).toMatchObject([
      { id: workspace.id, name: "Billing", sessions: [{ id: session.id }] },
    ]);
  });

  it("answers 409 when the name is taken by another Workspace, and changes nothing", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    await server.createWorkspace({ folder: instance.makeFolder("a"), name: "Billing" });
    const other = await server.createWorkspace({
      folder: instance.makeFolder("b"),
      name: "Search",
    });

    const response = await server.patch(`/api/workspaces/${other.id}`, {
      name: "Billing",
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toContain("Billing");
    expect((await server.state()).workspaces.map((w) => w.name)).toEqual([
      "Billing",
      "Search",
    ]);
  });

  it("accepts a Workspace's own name again", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("a"),
      name: "Billing",
    });

    const response = await server.patch(`/api/workspaces/${workspace.id}`, {
      name: "Billing",
    });

    expect(response.status).toBe(200);
  });

  it("answers 422 for a blank name and 404 for an unknown Workspace", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({ folder: instance.makeFolder("a") });

    const blank = await server.patch(`/api/workspaces/${workspace.id}`, { name: "   " });
    const unknown = await server.patch("/api/workspaces/nope", { name: "X" });

    expect(blank.status).toBe(422);
    expect(unknown.status).toBe(404);
  });

  it("survives a server restart", async () => {
    const instance = createTestInstance();
    const first = await instance.start();
    const workspace = await first.createWorkspace({ folder: instance.makeFolder("a") });
    await first.patch(`/api/workspaces/${workspace.id}`, { name: "Renamed" });

    await first.stop();
    const second = await instance.start();

    expect((await second.state()).workspaces.map((w) => w.name)).toEqual(["Renamed"]);
  });
});

describe("Changing a Workspace's folder", () => {
  it("points the Workspace at the new folder, and new Sessions start there", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("old"),
    });
    const moved = instance.makeFolder("moved");

    const response = await server.patch(`/api/workspaces/${workspace.id}`, {
      folder: moved,
    });

    expect(response.status).toBe(200);
    expect((await server.state()).workspaces).toMatchObject([
      { id: workspace.id, name: "old", folder: moved },
    ]);
    const session = await server.createSession(workspace.id);
    const terminal = await server.openTerminal(session.id);
    terminal.run('echo "cwd=$(pwd -P)="');
    await terminal.waitForOutput(`cwd=${moved}=`);
  });

  it("answers 422 for a folder that does not exist, and keeps the old folder", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("old");
    const workspace = await server.createWorkspace({ folder });

    const response = await server.patch(`/api/workspaces/${workspace.id}`, {
      folder: join(instance.root, "nope"),
    });

    expect(response.status).toBe(422);
    expect((await server.state()).workspaces[0]?.folder).toBe(folder);
  });

  it("answers 422 for a file, and applies neither change when one of the two is bad", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("old");
    const workspace = await server.createWorkspace({ folder });
    writeFileSync(join(instance.root, "file.txt"), "x");

    const file = await server.patch(`/api/workspaces/${workspace.id}`, {
      folder: join(instance.root, "file.txt"),
    });
    const both = await server.patch(`/api/workspaces/${workspace.id}`, {
      name: "Renamed",
      folder: join(instance.root, "nope"),
    });

    expect(file.status).toBe(422);
    expect(both.status).toBe(422);
    expect((await server.state()).workspaces).toMatchObject([{ name: "old", folder }]);
  });
});

describe("Reordering Workspaces", () => {
  it("persists the new order across a server restart", async () => {
    const instance = createTestInstance();
    const first = await instance.start();
    const a = await first.createWorkspace({ folder: instance.makeFolder("a") });
    const b = await first.createWorkspace({ folder: instance.makeFolder("b") });
    const c = await first.createWorkspace({ folder: instance.makeFolder("c") });

    const response = await first.put("/api/workspaces/order", {
      ids: [c.id, a.id, b.id],
    });

    expect(response.status).toBe(200);
    expect((await first.state()).workspaces.map((w) => w.name)).toEqual(["c", "a", "b"]);
    await first.stop();
    const second = await instance.start();
    expect((await second.state()).workspaces.map((w) => w.name)).toEqual(["c", "a", "b"]);
  });

  it("puts a Workspace created afterwards last", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const a = await server.createWorkspace({ folder: instance.makeFolder("a") });
    const b = await server.createWorkspace({ folder: instance.makeFolder("b") });
    await server.put("/api/workspaces/order", { ids: [b.id, a.id] });

    await server.createWorkspace({ folder: instance.makeFolder("c") });

    expect((await server.state()).workspaces.map((w) => w.name)).toEqual(["b", "a", "c"]);
  });

  it("answers 422 unless the list is exactly every Workspace, and changes nothing", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const a = await server.createWorkspace({ folder: instance.makeFolder("a") });
    const b = await server.createWorkspace({ folder: instance.makeFolder("b") });

    for (const ids of [[b.id], [b.id, a.id, "nope"], [b.id, b.id], "b,a"]) {
      const response = await server.put("/api/workspaces/order", { ids });
      expect(response.status, JSON.stringify(ids)).toBe(422);
    }
    expect((await server.state()).workspaces.map((w) => w.name)).toEqual(["a", "b"]);
  });
});

describe("Deleting a Workspace", () => {
  it("ends its Sessions' shells, removes them from the state, and leaves the folder and its files", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("project");
    writeFileSync(join(folder, "keep-me.txt"), "precious");
    const workspace = await server.createWorkspace({ folder });
    const other = await server.createWorkspace({ folder: instance.makeFolder("other") });
    const otherSession = await server.createSession(other.id);
    const session = await server.createSession(workspace.id);
    const terminal = await server.openTerminal(session.id);
    terminal.run(`${echoCommand("alive-before-delete-4e1c")}; sleep 600`);
    await terminal.waitForOutput("alive-before-delete-4e1c");

    const response = await server.delete(`/api/workspaces/${workspace.id}`);

    expect(response.status).toBe(204);
    // The shell is gone: its terminal closes, and the Session is no longer known.
    expect(await terminal.waitForClose()).toBeGreaterThan(1000);
    expect((await server.state()).workspaces).toMatchObject([
      { id: other.id, sessions: [{ id: otherSession.id, status: "running" }] },
    ]);
    const reopened = await server.openTerminal(session.id);
    expect(await reopened.waitForClose()).toBe(4404);
    expect(existsSync(join(folder, "keep-me.txt"))).toBe(true);
  });

  it("stays deleted across a server restart, and a fresh Workspace may reuse the name", async () => {
    const instance = createTestInstance();
    const first = await instance.start();
    const folder = instance.makeFolder("project");
    const workspace = await first.createWorkspace({ folder });
    await first.createSession(workspace.id);
    await first.delete(`/api/workspaces/${workspace.id}`);

    await first.stop();
    const second = await instance.start();

    expect((await second.state()).workspaces).toEqual([]);
    const again = await second.createWorkspace({ folder });
    expect(again.name).toBe("project");
  });

  it("deletes a Workspace with no Sessions, and one whose folder has gone", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const empty = await server.createWorkspace({ folder: instance.makeFolder("empty") });
    const gone = await server.createWorkspace({ folder: instance.makeFolder("gone") });
    await server.createSession(gone.id);
    rmSync(join(instance.root, "gone"), { recursive: true });

    expect((await server.delete(`/api/workspaces/${empty.id}`)).status).toBe(204);
    expect((await server.delete(`/api/workspaces/${gone.id}`)).status).toBe(204);

    await pollUntil(async () => (await server.state()).workspaces.length === 0, {
      description: "both Workspaces gone",
    });
  });

  it("answers 404 for an unknown Workspace", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const response = await server.delete("/api/workspaces/nope");

    expect(response.status).toBe(404);
  });
});
