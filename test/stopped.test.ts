import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentFolder,
  agentLogFile,
  agentsRoot,
  runtimesRoot,
} from "../src/agent/paths.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { createTestInstance, type TestServer } from "./harness/instance.ts";
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

  it("ends the terminal when the shell exits", async () => {
    const { server, session } = await bootSession();
    const terminal = await server.openTerminal(session.id);

    terminal.run("exit");

    await terminal.waitForEnded();
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

// A Claude Agent: Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are
// the real ones.

/** The status of the only Session in the only Workspace. */
async function onlySessionStatus(server: TestServer) {
  return (await server.state()).workspaces[0]?.sessions[0]?.status;
}

/** Opens a Stopped Agent's socket and waits for the read-only Transcript the server serves. */
async function openStopped(
  server: TestServer,
  sessionId: string,
  options: { tailTurns?: number } = {},
) {
  const client = await server.openAgent(sessionId);
  await client.sync(0, options);
  const reason = await pollUntil(() => client.stoppedReason, {
    description: "the server to say why the Agent is Stopped",
  });
  return { client, reason };
}

/** What each start of the fake Claude Code was given. */
const startsOf = (fakeClaude: FakeClaude) =>
  fakeClaude.received().flatMap((entry) => (entry.kind === "start" ? [entry] : []));

describe("Stopping a Claude Agent", () => {
  it("from Idle ends it, and its whole conversation stays readable: from disk, read-only, with the reason, paged back like a live one", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    for (const [index, text] of ["one", "two", "three"].entries()) {
      live.prompt(text);
      await pollUntil(() => live.entries.filter(isResult).length === index + 1, {
        description: `the answer to ${text}`,
      });
    }

    const response = await server.post(`/api/sessions/${session.id}/stop`);

    expect(response.status).toBe(200);
    expect(await onlySessionStatus(server)).toBe("stopped");
    expect(tmuxSessionNames(instance.config.tmuxSocket)).toEqual([]);
    expect(await live.waitForClose()).toBe(4410);
    const { client, reason } = await openStopped(server, session.id, { tailTurns: 1 });
    expect(reason).toBeTruthy();
    // The latest turn comes first; the rest by `page`, exactly as from a running Agent.
    expect(client.assistantTexts).toEqual(["fake claude heard: three"]);
    const earlier = await client.page(client.replayFrom ?? 0, 5);
    expect(earlier.entries.flatMap((e) => (e.kind === "prompt" ? [e.text] : []))).toEqual(
      ["one", "two"],
    );
    // Nothing a Stopped Agent is sent reaches anything: the log does not grow.
    const before = readFileSync(
      agentLogFile(agentFolder(instance.config.dataDir, session.id)),
      "utf8",
    );
    client.prompt("anyone there?");
    client.answer("nope", "allow");
    await openStopped(server, session.id);
    expect(
      readFileSync(
        agentLogFile(agentFolder(instance.config.dataDir, session.id)),
        "utf8",
      ),
    ).toBe(before);
  });

  it("mid-turn interrupts the turn and closes an open ask as not answered, which stays closed in the Stopped Transcript", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    instance.fakeClaude.script([
      { tool: { name: "Bash", input: { command: "rm -rf build" } }, ask: true },
      { text: "done" },
    ]);
    live.prompt("clean");
    const ask = await live.waitForAsk();

    await server.post(`/api/sessions/${session.id}/stop`);

    const { client } = await openStopped(server, session.id);
    const answers = client.entries.filter(
      (e) => e.kind === "permission_answered" && e.requestId === ask.requestId,
    );
    expect(answers).toMatchObject([{ answer: { decision: "interrupted" } }]);
    expect(client.openAsks).toEqual([]);
    // The tool never ran: Claude Code was never told yes.
    expect(
      instance.fakeClaude
        .received()
        .some(
          (e) =>
            e.kind === "control_response" &&
            JSON.stringify(e.message).includes('"allow"'),
        ),
    ).toBe(false);
  });

  it("is refused for a Session that is not a Claude Agent, and for one that is unknown", async () => {
    const { server, workspace } = await boot();
    const shell = await server.createSession(workspace.id);

    expect((await server.post(`/api/sessions/${shell.id}/stop`)).status).toBe(422);
    expect((await server.post("/api/sessions/nope/stop")).status).toBe(404);
    expect(await onlySessionStatus(server)).toBe("running");
  });
});

describe("Restarting a Stopped Claude Agent", () => {
  it("resumes the same conversation with the same Launch options, on the same log", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id, {
      claude: { model: "opus", effort: "high", advisor: "sonnet", focusView: true },
    });
    const first = await server.openAgent(session.id);
    await first.sync();
    first.prompt("before");
    await first.waitForEntry(isResult, "the first answer");
    await server.post(`/api/sessions/${session.id}/stop`);

    const restarted = await server.post(`/api/sessions/${session.id}/restart`);

    expect(restarted.status).toBe(200);
    const [before, after] = startsOf(instance.fakeClaude);
    const conversation = before?.argv
      .find((arg) => arg.startsWith("--session-id="))
      ?.split("=")[1];
    expect(conversation).toBeTruthy();
    expect(after?.argv).toContain(`--resume=${conversation}`);
    for (const flag of ["--model=opus", "--effort=high"]) {
      expect(after?.argv).toContain(flag);
    }
    expect(after?.argv.join(" ")).toContain("--advisor sonnet");
    const settings = after?.argv[after.argv.indexOf("--settings") + 1] ?? "";
    expect(JSON.parse(settings)).toEqual({ viewMode: "focus" });
    const again = await server.openAgent(session.id);
    await again.sync();
    again.prompt("after");
    await pollUntil(() => again.entries.filter(isResult).length === 2, {
      description: "the second answer",
    });
    expect(again.entries.map((e) => e.seq)).toEqual(again.entries.map((_, i) => i + 1));
    expect(again.assistantTexts).toEqual([
      "fake claude heard: before",
      "fake claude heard: after",
    ]);
  });
});

describe("A Claude Agent that ends by itself", () => {
  it("is Stopped with the reason Claude Code gave, and is not started again, not even when k-bench restarts", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    instance.fakeClaude.script([{ exit: 1, stderr: "claude fell over" }]);
    live.prompt("go");

    await pollUntil(async () => (await onlySessionStatus(server)) === "stopped", {
      description: "the Agent to be Stopped",
    });
    await server.stop();
    const restarted = await instance.start();

    expect(await onlySessionStatus(restarted)).toBe("stopped");
    const { client, reason } = await openStopped(restarted, session.id);
    expect(reason).toContain("claude fell over");
    // What it was asked is still there to read.
    expect(client.entries.some((e) => e.kind === "prompt" && e.text === "go")).toBe(true);
    expect(startsOf(instance.fakeClaude)).toHaveLength(1);
  });

  it("is Stopped, with a reason, when its tmux server goes down", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);

    killTmuxServer(instance.config.tmuxSocket);

    await pollUntil(async () => (await onlySessionStatus(server)) === "stopped", {
      description: "the Agent to be Stopped",
    });
    const { reason } = await openStopped(server, session.id);
    expect(reason).toBeTruthy();
    expect(startsOf(instance.fakeClaude)).toHaveLength(1);
  });

  it("is Stopped, with a reason, when its runtime is killed outright, and what the log left open is still open there for the browser to close", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const live = await server.openAgent(session.id);
    await live.sync();
    instance.fakeClaude.script([
      { tool: { name: "Bash", input: { command: "ls" } }, ask: true },
    ]);
    live.prompt("go");
    await live.waitForAsk();

    // Only this instance's runtime: its path is inside the test's own data directory.
    execFileSync("pkill", ["-9", "-f", runtimesRoot(instance.config.dataDir)]);

    await pollUntil(async () => (await onlySessionStatus(server)) === "stopped", {
      description: "the Agent to be Stopped",
    });
    const { client, reason } = await openStopped(server, session.id);
    expect(reason).toBeTruthy();
    // Nobody could write the closing entry: the log says the ask is open, and the Stopped
    // message is what tells a browser that nothing ever will answer it.
    expect(client.openAsks).toHaveLength(1);
    expect(startsOf(instance.fakeClaude)).toHaveLength(1);
  });
});

describe("Agent folders at start", () => {
  it("removes one that no Session has, and keeps one that a Session has", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const root = agentsRoot(instance.config.dataDir);
    await server.stop();
    const stray = join(root, "00000000-0000-4000-8000-000000000000");
    mkdirSync(stray);
    writeFileSync(join(stray, "log.jsonl"), "");

    await instance.start();

    expect(readdirSync(root)).toEqual([session.id]);
  });
});
