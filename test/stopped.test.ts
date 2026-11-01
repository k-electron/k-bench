import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { echoCommand } from "./harness/terminal.ts";
import { killTmuxServer, plantTmuxSession, tmuxSessionNames } from "./harness/tmux.ts";

async function bootSession() {
  const instance = createTestInstance();
  const server = await instance.start();
  const folder = instance.makeFolder("project");
  const workspace = await server.createWorkspace({ folder });
  const session = await server.createSession(workspace.id);
  return { instance, server, folder, workspace, session };
}

describe("Stopped Sessions", () => {
  it("reports a Session Stopped after its shell exits, and keeps the others running", async () => {
    const { server, workspace, session } = await bootSession();
    const other = await server.createSession(workspace.id);
    const terminal = await server.openTerminal(session.id);

    terminal.run("exit");

    await pollUntil(
      async () => {
        const [ws] = (await server.state()).workspaces;
        return ws?.sessions.find((s) => s.id === session.id)?.status === "stopped";
      },
      { description: "the Session to be Stopped" },
    );
    const [ws] = (await server.state()).workspaces;
    expect(ws?.sessions).toMatchObject([
      { id: session.id, name: "session 1", status: "stopped" },
      { id: other.id, name: "session 2", status: "running" },
    ]);
  });

  it("makes every Session Stopped when the tmux server dies, while Workspaces remain", async () => {
    const { instance, server, workspace } = await bootSession();
    await server.createSession(workspace.id);
    const second = await server.createWorkspace({
      folder: instance.makeFolder("other"),
    });
    await server.createSession(second.id);

    killTmuxServer(instance.config.tmuxSocket);

    const state = await server.state();
    expect(state.workspaces.map((w) => w.name)).toEqual(["project", "other"]);
    const statuses = state.workspaces.flatMap((w) => w.sessions.map((s) => s.status));
    expect(statuses).toEqual(["stopped", "stopped", "stopped"]);
  });

  it("closes the terminal socket as Stopped when the shell exits", async () => {
    const { server, session } = await bootSession();
    const terminal = await server.openTerminal(session.id);

    terminal.run("exit");

    expect(await terminal.waitForClose()).toBe(4410);
  });
});

describe("Restarting a Stopped Session", () => {
  it("gives a working shell in the Workspace folder with the same id and name", async () => {
    const { instance, server, folder, session } = await bootSession();
    killTmuxServer(instance.config.tmuxSocket);

    const response = await server.post(`/api/sessions/${session.id}/restart`);

    expect(response.status).toBe(200);
    const [ws] = (await server.state()).workspaces;
    expect(ws?.sessions).toMatchObject([
      { id: session.id, name: session.name, status: "running" },
    ]);
    const terminal = await server.openTerminal(session.id);
    terminal.run("pwd");
    await terminal.waitForOutput(folder);
    terminal.run(echoCommand("restarted-7c41"));
    await terminal.waitForOutput("restarted-7c41");
  });

  it("restarts a Session whose shell exited, leaving its sibling untouched", async () => {
    const { server, workspace, session } = await bootSession();
    const sibling = await server.createSession(workspace.id);
    const siblingTerminal = await server.openTerminal(sibling.id);
    siblingTerminal.run(`${echoCommand("sibling-5d02")}; sleep 600`);
    await siblingTerminal.waitForOutput("sibling-5d02");
    (await server.openTerminal(session.id)).run("exit");
    await pollUntil(async () => {
      const [ws] = (await server.state()).workspaces;
      return ws?.sessions.find((s) => s.id === session.id)?.status === "stopped";
    });

    expect((await server.post(`/api/sessions/${session.id}/restart`)).status).toBe(200);

    const [ws] = (await server.state()).workspaces;
    expect(ws?.sessions.map((s) => s.status)).toEqual(["running", "running"]);
    const again = await server.openTerminal(sibling.id);
    await again.waitForOutput("sibling-5d02");
  });

  it("leaves a running Session alone", async () => {
    const { server, session } = await bootSession();
    const before = await server.openTerminal(session.id);
    before.run(`${echoCommand("still-here-9a3b")}; sleep 600`);
    await before.waitForOutput("still-here-9a3b");

    expect((await server.post(`/api/sessions/${session.id}/restart`)).status).toBe(200);

    const after = await server.openTerminal(session.id);
    await after.waitForOutput("still-here-9a3b");
  });

  it("refuses with 422 when the Workspace folder is Missing, and stays Stopped", async () => {
    const { instance, server, folder, session } = await bootSession();
    killTmuxServer(instance.config.tmuxSocket);
    rmSync(folder, { recursive: true });

    const response = await server.post(`/api/sessions/${session.id}/restart`);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain(folder);
    const [ws] = (await server.state()).workspaces;
    expect(ws?.sessions).toMatchObject([{ id: session.id, status: "stopped" }]);
  });

  it("answers 404 for an unknown Session", async () => {
    const { server } = await bootSession();

    expect((await server.post("/api/sessions/nope/restart")).status).toBe(404);
  });
});

describe("Reconciling tmux with the store", () => {
  it("removes a tmux session with no store record when the server starts", async () => {
    const { instance, server, session } = await bootSession();
    const socket = instance.config.tmuxSocket;
    await server.stop();
    plantTmuxSession(socket, "kb-orphan-from-before");
    expect(tmuxSessionNames(socket)).toContain("kb-orphan-from-before");

    const restarted = await instance.start();

    // No state read here: the cleanup is the server's startup, not a request.
    await pollUntil(() => !tmuxSessionNames(socket).includes("kb-orphan-from-before"), {
      description: "the orphan tmux session to be removed",
    });
    expect(tmuxSessionNames(socket)).toEqual([`kb-${session.id}`]);
    const [ws] = (await restarted.state()).workspaces;
    expect(ws?.sessions).toMatchObject([{ id: session.id, status: "running" }]);
  });

  it("removes one that appears while the server runs, the next time state is read", async () => {
    const { instance, server } = await bootSession();
    const socket = instance.config.tmuxSocket;
    plantTmuxSession(socket, "kb-orphan-while-running");

    await server.state();

    await pollUntil(() => !tmuxSessionNames(socket).includes("kb-orphan-while-running"), {
      description: "the orphan tmux session to be removed",
    });
  });
});
