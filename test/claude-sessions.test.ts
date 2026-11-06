import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fakeClaudeArgs } from "./harness/fake-claude.ts";
import { createTestInstance, type TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { typeIntoSession } from "./harness/tmux.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_HELD = "Claude Code exited with an error. Press any key to close.";

async function boot() {
  const instance = createTestInstance();
  const server = await instance.start();
  const folder = instance.makeFolder("project");
  const workspace = await server.createWorkspace({ folder });
  return { instance, server, folder, workspace };
}

async function sessionState(server: TestServer, sessionId: string) {
  const state = await server.state();
  return state.workspaces.flatMap((w) => w.sessions).find((s) => s.id === sessionId);
}

function untilStopped(server: TestServer, sessionId: string) {
  return pollUntil(
    async () => (await sessionState(server, sessionId))?.status === "stopped",
    { description: "the Session to be Stopped" },
  );
}

describe("Claude Sessions", () => {
  it("launches Claude Code in the Workspace folder with its conversation ID, beside ordinary shell Sessions", async () => {
    const { server, folder, workspace } = await boot();
    const shell = await server.createSession(workspace.id);

    const claude = await server.createClaudeSession(workspace.id);

    const sessions = (await server.state()).workspaces[0]?.sessions;
    expect(sessions).toMatchObject([
      { id: shell.id, kind: "shell", status: "running" },
      { id: claude.id, name: "session 2", kind: "claude", status: "running" },
    ]);
    const terminal = await server.openTerminal(claude.id);
    const args = await fakeClaudeArgs(terminal);
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("--session-id");
    expect(args[1]).toMatch(UUID);
    expect(terminal.output).toContain(`claude-stub cwd: ${folder}`);
    expect(terminal.output).toContain("advisor tool disabled: unset");
  });

  it("gives each Claude Session its own conversation ID", async () => {
    const { server, workspace } = await boot();
    const first = await server.createClaudeSession(workspace.id);
    const second = await server.createClaudeSession(workspace.id);

    const [firstArgs, secondArgs] = await Promise.all([
      server.openTerminal(first.id).then(fakeClaudeArgs),
      server.openTerminal(second.id).then(fakeClaudeArgs),
    ]);

    expect(firstArgs[1]).not.toBe(secondArgs[1]);
  });

  it("names it as asked, refuses a taken name, and numbers an unnamed one", async () => {
    const { server, workspace } = await boot();
    await server.createClaudeSession(workspace.id, { name: "refactor" });

    const taken = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      name: "refactor",
      claude: {},
    });
    const unnamed = await server.createClaudeSession(workspace.id, { name: "  " });

    expect(taken.status).toBe(409);
    expect(unnamed.name).toBe("session 1");
    expect((await server.state()).workspaces[0]?.sessions).toHaveLength(2);
  });

  it("refuses launch options that are not an object, and creates no Session", async () => {
    const { server, workspace } = await boot();

    const response = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      claude: "opus",
    });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain("claude");
    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
  });

  it("is Stopped when Claude Code quits with status 0, with no shell left underneath", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const other = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");

    terminal.run("exit 0");

    await terminal.waitForEnded();
    await untilStopped(server, claude.id);
    expect(terminal.output).not.toContain(ERROR_HELD);
    expect((await sessionState(server, other.id))?.status).toBe("running");
  });

  it("holds the error on screen when Claude Code fails, until a key is pressed", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");

    terminal.run("exit 3");

    await terminal.waitForOutput(ERROR_HELD);
    // Still running while it waits: nothing but a key ends it.
    expect((await sessionState(server, claude.id))?.status).toBe("running");
    terminal.type("q");
    await terminal.waitForEnded();
    await untilStopped(server, claude.id);
  });

  it("holds the error when Claude Code cannot be started at all", async () => {
    const instance = createTestInstance({
      claudeProgram: "claude-that-is-not-installed",
    });
    const server = await instance.start();
    const workspace = await server.createWorkspace({
      folder: instance.makeFolder("project"),
    });
    const claude = await server.createClaudeSession(workspace.id);

    const terminal = await server.openTerminal(claude.id);

    await terminal.waitForOutput(ERROR_HELD);
    expect((await sessionState(server, claude.id))?.status).toBe("running");
  });

  it("restarts as Claude Code again, not as a shell", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const first = await server.openTerminal(claude.id);
    const [flag, conversationId] = await fakeClaudeArgs(first);
    first.run("exit 0");
    await untilStopped(server, claude.id);

    const response = await server.post(`/api/sessions/${claude.id}/restart`);

    expect(response.status).toBe(200);
    expect(await sessionState(server, claude.id)).toMatchObject({
      kind: "claude",
      status: "running",
    });
    const again = await fakeClaudeArgs(await server.openTerminal(claude.id));
    expect(again).toEqual([flag, conversationId]);
  });

  it("is renamed, rings a Bell and is deleted like any Session", async () => {
    const { instance, server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);

    const renamed = await server.renameSession(claude.id, "renamed");
    expect(renamed.status).toBe(200);
    typeIntoSession(instance.config.tmuxSocket, claude.id, "bell");
    await pollUntil(async () => (await sessionState(server, claude.id))?.bell === true, {
      description: "the Bell to be raised",
    });
    const deleted = await server.deleteSession(claude.id);

    expect(deleted.status).toBe(204);
    expect(await sessionState(server, claude.id)).toBeUndefined();
  });
});

describe("Sessions that existed before Claude Sessions", () => {
  it("are shell Sessions after an upgrade", async () => {
    const instance = createTestInstance();
    const folder = instance.makeFolder("project");
    // The store as the first version of k-bench left it.
    mkdirSync(instance.config.dataDir, { recursive: true });
    const old = new DatabaseSync(join(instance.config.dataDir, "k-bench.db"));
    old.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, position INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
      INSERT INTO workspaces VALUES ('w1', 'project', '${folder}', 0);
      INSERT INTO sessions VALUES ('s1', 'w1', 'build', 1);
      PRAGMA user_version = 1;
    `);
    old.close();

    const server = await instance.start();

    expect((await server.state()).workspaces[0]?.sessions).toMatchObject([
      { id: "s1", name: "build", kind: "shell", status: "stopped" },
    ]);
  });
});
