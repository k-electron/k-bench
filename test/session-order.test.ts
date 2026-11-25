import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { createTestInstance, otherSessions } from "./harness/instance.ts";

describe("Ordering a Workspace's Other Sessions", () => {
  it("lists them in the owner's order after the Prime and Worker, across a restart, with a new Session last", async () => {
    const { instance, server, workspace } = await boot();
    const a = await server.createSession(workspace.id, "a");
    const b = await server.createSession(workspace.id, "b");
    const c = await server.createSession(workspace.id, "c");

    const response = await server.put(`/api/workspaces/${workspace.id}/sessions/order`, {
      ids: [c.id, a.id, b.id],
    });

    expect(response.status).toBe(200);
    const names = async (s: typeof server) =>
      (await s.state()).workspaces[0]?.sessions.map((session) => session.name);
    expect(await names(server)).toEqual(["Prime", "Worker", "c", "a", "b"]);
    await server.stop();
    const again = await instance.start();
    expect(await names(again)).toEqual(["Prime", "Worker", "c", "a", "b"]);
    await again.createSession(workspace.id, "d");
    expect(await names(again)).toEqual(["Prime", "Worker", "c", "a", "b", "d"]);
  });

  it("answers 422 unless the list is exactly the Workspace's Other Sessions, and changes nothing", async () => {
    const { instance, server, workspace } = await boot();
    const a = await server.createSession(workspace.id, "a");
    const b = await server.createSession(workspace.id, "b");
    const [prime, worker] = (await server.state()).workspaces[0]?.sessions ?? [];
    const elsewhere = await server.createWorkspace({
      folder: instance.makeFolder("other"),
    });
    const stranger = await server.createSession(elsewhere.id, "stranger");

    for (const ids of [
      [b.id],
      [b.id, a.id, "nope"],
      [b.id, b.id],
      [b.id, a.id, prime?.id],
      [worker?.id, b.id, a.id],
      [b.id, a.id, stranger.id],
      "b,a",
    ]) {
      const path = `/api/workspaces/${workspace.id}/sessions/order`;
      const response = await server.put(path, { ids });
      expect(response.status, JSON.stringify(ids)).toBe(422);
    }
    expect(
      (await server.state()).workspaces[0]?.sessions.map((session) => session.name),
    ).toEqual(["Prime", "Worker", "a", "b"]);
    const unknown = await server.put("/api/workspaces/nope/sessions/order", { ids: [] });
    expect(unknown.status).toBe(404);
  });

  it("keeps Sessions from before the upgrade in the order they were created", async () => {
    const instance = createTestInstance();
    const folder = instance.makeFolder("project");
    // The store as the first version of k-bench left it, with rows stored out of creation order.
    mkdirSync(instance.config.dataDir, { recursive: true });
    const old = new DatabaseSync(join(instance.config.dataDir, "k-bench.db"));
    old.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, position INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
      INSERT INTO workspaces VALUES ('w1', 'project', '${folder}', 0);
      INSERT INTO sessions VALUES ('s3', 'w1', 'third', 30);
      INSERT INTO sessions VALUES ('s1', 'w1', 'first', 10);
      INSERT INTO sessions VALUES ('s2', 'w1', 'second', 20);
      PRAGMA user_version = 1;
    `);
    old.close();

    const server = await instance.start();

    expect(
      otherSessions((await server.state()).workspaces[0]).map((session) => session.name),
    ).toEqual(["first", "second", "third"]);
  });
});
