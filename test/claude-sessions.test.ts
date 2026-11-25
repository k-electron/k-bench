import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeClaudeArgs, fakeClaudeSettings } from "./harness/fake-claude.ts";
import {
  createTestInstance,
  otherSessions,
  type TestServer,
} from "./harness/instance.ts";
import { writeOldStore } from "./harness/old-store.ts";
import { pollUntil } from "./harness/poll.ts";
import { typeIntoSession } from "./harness/tmux.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FOCUS_SETTINGS = { viewMode: "focus", tui: "fullscreen" };
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

    const sessions = otherSessions((await server.state()).workspaces[0]);
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
    expect(otherSessions((await server.state()).workspaces[0])).toHaveLength(2);
  });

  it("refuses launch options that are not an object, and creates no Session", async () => {
    const { server, workspace } = await boot();

    const response = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      claude: "opus",
    });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain("claude");
    expect(otherSessions((await server.state()).workspaces[0])).toEqual([]);
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

  it("resumes its conversation when restarted after a message was sent, with every Launch option again", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id, {
      claude: { model: "opus", advisor: "off", focusView: true },
    });
    const first = await server.openTerminal(claude.id);
    const [, conversationId] = await fakeClaudeArgs(first);
    first.run("what is in this folder");
    await first.waitForOutput("claude-stub heard: what is in this folder");
    first.run("exit 0");
    await untilStopped(server, claude.id);

    const response = await server.post(`/api/sessions/${claude.id}/restart`);

    expect(response.status).toBe(200);
    expect(await sessionState(server, claude.id)).toMatchObject({
      kind: "claude",
      status: "running",
    });
    const again = await server.openTerminal(claude.id);
    expect(await fakeClaudeArgs(again)).toEqual([
      "--resume",
      conversationId,
      "--model",
      "opus",
    ]);
    expect(await fakeClaudeSettings(again)).toEqual(FOCUS_SETTINGS);
    expect(again.output).toContain("advisor tool disabled: 1");
    expect(again.output).not.toContain("No conversation found");
  });

  it("starts a fresh conversation with the same ID and options when nothing was ever sent", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id, {
      claude: { effort: "high", advisor: "off" },
    });
    const first = await server.openTerminal(claude.id);
    const launched = await fakeClaudeArgs(first);
    first.run("exit 0");
    await untilStopped(server, claude.id);

    await server.post(`/api/sessions/${claude.id}/restart`);

    const again = await server.openTerminal(claude.id);
    expect(await fakeClaudeArgs(again)).toEqual(launched);
    expect(again.output).toContain("advisor tool disabled: 1");
    // The resume was tried first and failed, and that is not shown as an error.
    expect(again.output).toContain("No conversation found");
    expect(again.output).not.toContain(ERROR_HELD);
    expect((await sessionState(server, claude.id))?.status).toBe("running");
  });

  it("holds the error when both attempts fail, then is Stopped on a key", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const first = await server.openTerminal(claude.id);
    first.run("a message, so there is a conversation");
    await first.waitForOutput("claude-stub heard:");
    first.run("exit 0");
    await untilStopped(server, claude.id);
    await server.post(`/api/sessions/${claude.id}/restart`);
    // The resume works, then Claude Code fails. A fresh start of a conversation that
    // exists fails as well, so both attempts have failed.
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");
    terminal.run("exit 3");

    await terminal.waitForOutput(ERROR_HELD);
    expect(terminal.output).toContain("is already in use");
    expect((await sessionState(server, claude.id))?.status).toBe("running");
    terminal.type("q");
    await terminal.waitForEnded();
    await untilStopped(server, claude.id);
  });

  it("refuses to restart in a Missing Workspace, as any Session does", async () => {
    const { server, folder, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub ready");
    terminal.run("exit 0");
    await untilStopped(server, claude.id);
    rmSync(folder, { recursive: true });

    const response = await server.post(`/api/sessions/${claude.id}/restart`);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain(folder);
    expect((await sessionState(server, claude.id))?.status).toBe("stopped");
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
    writeOldStore(
      instance,
      1,
      `
      INSERT INTO workspaces VALUES ('w1', 'project', '${folder}', 0);
      INSERT INTO sessions VALUES ('s1', 'w1', 'build', 1);
    `,
    );

    const server = await instance.start();

    expect(otherSessions((await server.state()).workspaces[0])).toMatchObject([
      { id: "s1", name: "build", kind: "shell", status: "stopped" },
    ]);
  });
});

describe("Workspaces that existed before the Prime and Worker", () => {
  it("each get a Stopped Prime and Worker after an upgrade, keeping every old Session as an Other Session", async () => {
    const instance = createTestInstance();
    const folder = instance.makeFolder("project");
    const empty = instance.makeFolder("empty");
    // The store as schema version 4 left it: a Workspace with a shell Session and a Claude
    // Session that the owner happened to name "Prime", and a Workspace with no Sessions.
    writeOldStore(
      instance,
      4,
      `
      ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'shell';
      ALTER TABLE sessions ADD COLUMN conversation_id TEXT;
      ALTER TABLE sessions ADD COLUMN launch_options TEXT;
      CREATE TABLE claude_last_launch_options (id INTEGER PRIMARY KEY CHECK (id = 1), options TEXT NOT NULL);
      INSERT INTO workspaces VALUES ('w1', 'project', '${folder}', 0);
      INSERT INTO workspaces VALUES ('w2', 'empty', '${empty}', 1);
      INSERT INTO sessions VALUES ('s1', 'w1', 'build', 1, 'shell', NULL, NULL);
      INSERT INTO sessions VALUES ('s2', 'w1', 'Prime', 2, 'claude',
        '11111111-1111-4111-8111-111111111111',
        '{"model":"sonnet","effort":"low","advisor":"off","focusView":false}');
    `,
    );

    const server = await instance.start();
    const { workspaces } = await server.state();

    for (const workspace of workspaces) {
      const roles = workspace.sessions.filter((session) => session.role !== null);
      expect(roles).toEqual([
        expect.objectContaining({
          role: "prime",
          name: "Prime",
          kind: "claude",
          status: "stopped",
        }),
        expect.objectContaining({
          role: "worker",
          name: "Worker",
          kind: "claude",
          status: "stopped",
        }),
      ]);
    }
    expect(workspaces.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(otherSessions(workspaces[0])).toMatchObject([
      { id: "s1", name: "build", kind: "shell", status: "stopped" },
      { id: "s2", name: "Prime (earlier)", kind: "claude", status: "stopped" },
    ]);
    expect(otherSessions(workspaces[1])).toEqual([]);
    // Listed like a new Workspace's: the Prime and Worker first.
    expect(workspaces[0]?.sessions.map((s) => s.name)).toEqual([
      "Prime",
      "Worker",
      "build",
      "Prime (earlier)",
    ]);
    // The renamed Session still runs its own conversation in its Workspace folder.
    await server.post("/api/sessions/s2/restart");
    const terminal = await server.openTerminal("s2");
    expect(await fakeClaudeArgs(terminal)).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(terminal.output).toContain(`claude-stub cwd: ${folder}`);
  });
});
