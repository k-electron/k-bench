import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";

describe("the folder picker's directory listing", () => {
  it("lists the subfolders of the configured root by default, in name order, without files", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    instance.makeFolder("beta");
    instance.makeFolder("Alpha");
    instance.makeFolder(".hidden");
    writeFileSync(join(instance.root, "notes.txt"), "not a folder");

    const response = await server.request("/api/directories");

    expect(response.status).toBe(200);
    const listing = (await response.json()) as {
      path: string;
      directories: Array<{ name: string; path: string }>;
    };
    expect(listing.path).toBe(instance.root);
    // `data` is the instance's own data folder, created next to the folders above.
    expect(listing.directories.map((d) => d.name)).toEqual(["Alpha", "beta", "data"]);
    expect(listing.directories[0]?.path).toBe(join(instance.root, "Alpha"));
  });

  it("starts at Home when there are no Workspaces, and names Home as the picker root", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const listing = (await (await server.request("/api/directories")).json()) as {
      path: string;
      root: string;
    };

    expect(listing.path).toBe(instance.root);
    expect(listing.root).toBe(instance.root);
  });

  it("starts in the parent of the most recently created Workspace's folder, whatever the sidebar order", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const work = instance.makeFolder("work");
    const play = instance.makeFolder("play");
    mkdirSync(join(work, "older"));
    mkdirSync(join(play, "newer"));
    const older = await server.createWorkspace({ folder: join(work, "older") });
    const newer = await server.createWorkspace({ folder: join(play, "newer") });
    await server.put("/api/workspaces/order", { ids: [newer.id, older.id] });

    const listing = (await (await server.request("/api/directories")).json()) as {
      path: string;
      root: string;
    };

    expect(listing.path).toBe(play);
    expect(listing.root).toBe(instance.root);
  });

  it("knows which Workspace is newest after upgrading a store from before creation times", async () => {
    const instance = createTestInstance();
    const older = join(instance.makeFolder("work"), "older");
    const newer = join(instance.makeFolder("play"), "newer");
    mkdirSync(older);
    mkdirSync(newer);
    // The store as the first version of k-bench left it, the newer Workspace dragged first.
    mkdirSync(instance.config.dataDir, { recursive: true });
    const old = new DatabaseSync(join(instance.config.dataDir, "k-bench.db"));
    old.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, position INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
      INSERT INTO workspaces VALUES ('w1', 'older', '${older}', 1);
      INSERT INTO workspaces VALUES ('w2', 'newer', '${newer}', 0);
      PRAGMA user_version = 1;
    `);
    old.close();
    const server = await instance.start();

    const listing = (await (await server.request("/api/directories")).json()) as {
      path: string;
    };

    expect(listing.path).toBe(join(instance.root, "play"));
  });

  it("starts at Home when the newest Workspace's parent folder is gone", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const gone = instance.makeFolder("gone");
    mkdirSync(join(gone, "app"));
    await server.createWorkspace({ folder: join(gone, "app") });
    rmSync(gone, { recursive: true });

    const listing = (await (await server.request("/api/directories")).json()) as {
      path: string;
    };

    expect(listing.path).toBe(instance.root);
  });

  it("lists the subfolders of a given path and says where its parent is", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const parent = instance.makeFolder("projects");
    mkdirSync(join(parent, "app"));
    mkdirSync(join(parent, "lib"));

    const response = await server.request(
      `/api/directories?path=${encodeURIComponent(parent)}`,
    );

    const listing = (await response.json()) as {
      path: string;
      parent: string;
      directories: Array<{ name: string }>;
    };
    expect(listing.path).toBe(parent);
    expect(listing.parent).toBe(instance.root);
    expect(listing.directories.map((d) => d.name)).toEqual(["app", "lib"]);
  });

  it("follows a symlink to a folder", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const target = instance.makeFolder("real");
    symlinkSync(target, join(instance.root, "link"));

    const response = await server.request("/api/directories");

    const names = (
      (await response.json()) as { directories: Array<{ name: string }> }
    ).directories.map((d) => d.name);
    expect(names).toContain("link");
  });

  it("rejects a path that does not exist, a file, and a relative path with 422", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    writeFileSync(join(instance.root, "file.txt"), "x");

    for (const path of [
      join(instance.root, "nope"),
      join(instance.root, "file.txt"),
      "relative/dir",
    ]) {
      const response = await server.request(
        `/api/directories?path=${encodeURIComponent(path)}`,
      );
      expect(response.status, path).toBe(422);
      expect(((await response.json()) as { error: string }).error).toBeTruthy();
    }
  });

  it("is refused to a login that is not the owner's", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const response = await server
      .as("someone-else@example.com")
      .request("/api/directories");

    expect(response.status).toBe(403);
  });
});

describe("Workspace names", () => {
  it("defaults to the folder name", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("my-project"),
    });

    expect(workspace.name).toBe("my-project");
    expect((await server.state()).workspaces.map((w) => w.name)).toEqual(["my-project"]);
  });

  it("gets a (2)-style suffix when another folder of the same name has one", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const first = await server.createWorkspace({ folder: instance.makeFolder("a/app") });
    const second = await server.createWorkspace({ folder: instance.makeFolder("b/app") });
    const third = await server.createWorkspace({ folder: instance.makeFolder("c/app") });

    expect([first.name, second.name, third.name]).toEqual(["app", "app (2)", "app (3)"]);
  });

  it("skips a suffixed name that is already taken", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    await server.createWorkspace({ folder: instance.makeFolder("x"), name: "app (2)" });

    const a = await server.createWorkspace({ folder: instance.makeFolder("a/app") });
    const b = await server.createWorkspace({ folder: instance.makeFolder("b/app") });

    expect([a.name, b.name]).toEqual(["app", "app (3)"]);
  });

  it("uses a name the owner types, trimmed", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("app"),
      name: "  Billing  ",
    });

    expect(workspace.name).toBe("Billing");
  });

  it("answers 409 for a name that is already taken, and creates nothing", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    await server.createWorkspace({ folder: instance.makeFolder("a"), name: "Billing" });

    const response = await server.post("/api/workspaces", {
      folder: instance.makeFolder("b"),
      name: "Billing",
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("Billing");
    expect((await server.state()).workspaces).toHaveLength(1);
  });

  it("answers 422 for a folder that does not exist", async () => {
    const instance = createTestInstance();
    const server = await instance.start();

    const response = await server.post("/api/workspaces", {
      folder: join(instance.root, "nope"),
    });

    expect(response.status).toBe(422);
    expect((await server.state()).workspaces).toHaveLength(0);
  });

  it("answers 422 for a file, which is not a folder", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    writeFileSync(join(instance.root, "file.txt"), "x");

    const response = await server.post("/api/workspaces", {
      folder: join(instance.root, "file.txt"),
    });

    expect(response.status).toBe(422);
  });
});

describe("One Workspace per folder", () => {
  it("refuses a Workspace on a folder another Workspace has, naming that Workspace", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("app");
    const owner = await server.createWorkspace({ folder, name: "Billing" });

    // The same folder, written another way.
    const response = await server.post("/api/workspaces", {
      folder: `${instance.root}/./app/`,
      name: "Other",
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: string;
      workspace: { id: string; name: string };
    };
    expect(body.workspace).toEqual({ id: owner.id, name: "Billing" });
    expect(body.error).toContain("Billing");
    expect((await server.state()).workspaces.map((w) => w.id)).toEqual([owner.id]);
  });
});
