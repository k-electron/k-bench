import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  it("gets a (2)-style suffix when the default name is taken, several Workspaces sharing one folder", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("app");

    const first = await server.createWorkspace({ folder });
    const second = await server.createWorkspace({ folder });
    const third = await server.createWorkspace({ folder });

    expect([first.name, second.name, third.name]).toEqual(["app", "app (2)", "app (3)"]);
    const state = await server.state();
    expect(state.workspaces.map((w) => [w.name, w.folder])).toEqual([
      ["app", folder],
      ["app (2)", folder],
      ["app (3)", folder],
    ]);
  });

  it("skips a suffixed name that is already taken", async () => {
    const instance = createTestInstance();
    const server = await instance.start();
    const folder = instance.makeFolder("app");
    await server.createWorkspace({ folder, name: "app (2)" });

    const a = await server.createWorkspace({ folder });
    const b = await server.createWorkspace({ folder });

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
