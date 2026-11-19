import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";

// What the `@` picker asks the server: files under the Agent's Workspace folder. The folders
// are the test instance's own temp ones; git is the real one, run on them alone.

function write(folder: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
}

async function search(
  server: { request(path: string): Promise<Response> },
  sessionId: string,
  query: string,
) {
  const response = await server.request(
    `/api/sessions/${sessionId}/files?q=${encodeURIComponent(query)}`,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { files: string[] }).files;
}

describe("file search for the `@` picker", () => {
  it("lists matching files best first, without git-ignored, deleted or escaping ones, and never leaves the folder", async () => {
    const { instance, server, workspace } = await boot();
    const folder = instance.makeFolder("project");
    const outside = instance.makeFolder("outside");
    write(folder, {
      ".gitignore": "ignored.log\nbuild/\n",
      "src/app.ts": "",
      "src/server/app-routes.ts": "",
      "README.md": "",
      "ignored.log": "",
      "build/app.js": "",
      "gone/app-old.ts": "",
    });
    write(outside, { "app-secret.ts": "", "other/app-deep.ts": "" });
    execFileSync("git", ["init", "--quiet"], { cwd: folder });
    // Tracked, then deleted from the folder: git still lists it.
    execFileSync("git", ["add", "src/app.ts", "gone/app-old.ts"], { cwd: folder });
    rmSync(join(folder, "gone"), { recursive: true });
    // Links out of the folder, to a file and to a folder.
    symlinkSync(join(outside, "app-secret.ts"), join(folder, "app-link.ts"));
    symlinkSync(join(outside, "other"), join(folder, "linked"));
    const agent = await server.createClaudeAgent(workspace.id);

    // The name that starts with the query comes first, the shallower of those first.
    expect(await search(server, agent.id, "app")).toEqual([
      "src/app.ts",
      "src/server/app-routes.ts",
    ]);
    // Any case, and a path matches as well as a name.
    expect(await search(server, agent.id, "SRC/SER")).toEqual([
      "src/server/app-routes.ts",
    ]);
    // Nothing typed lists the shallowest files, the ignored ones still left out.
    const all = await search(server, agent.id, "");
    expect(all[0]).toBe("README.md");
    expect(all).toContain(".gitignore");
    expect(all).not.toContain("ignored.log");

    // A query is only matched against names under the folder, never followed to a path.
    expect(await search(server, agent.id, "../outside/app-secret.ts")).toEqual([]);
    expect(await search(server, agent.id, outside)).toEqual([]);
    expect(await search(server, agent.id, "app-secret")).toEqual([]);
  });

  it("caps the list, and in a folder that is not a git repository skips node_modules and .git", async () => {
    const { instance, server } = await boot();
    const folder = instance.makeFolder("plain");
    write(folder, {
      "lib/app.js": "",
      "node_modules/dep/app.js": "",
      ".git/app-config": "",
    });
    for (let n = 0; n < 40; n++) write(folder, { [`many/file-${n}.txt`]: "" });
    const workspace = await server.createWorkspace({ folder });
    const agent = await server.createClaudeAgent(workspace.id);

    expect(await search(server, agent.id, "app")).toEqual(["lib/app.js"]);
    expect(await search(server, agent.id, "file-")).toHaveLength(30);
  });

  it("answers only for a Claude Agent", async () => {
    const { server, workspace } = await boot();
    const shell = await server.createSession(workspace.id);
    expect((await server.request(`/api/sessions/${shell.id}/files?q=a`)).status).toBe(
      404,
    );
    expect((await server.request("/api/sessions/nope/files?q=a")).status).toBe(404);
  });
});
