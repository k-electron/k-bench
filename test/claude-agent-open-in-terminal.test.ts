import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentFolder } from "../src/agent/paths.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { type FakeClaude, fakeClaudeArgs } from "./harness/fake-claude.ts";
import type { TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { killTmuxServer, tmuxSessionNames } from "./harness/tmux.ts";

// Claude Code is the fake `claude`: the SDK-driven one for the Agent, the TUI stub once the
// Session is in the terminal. The Agent Runtime and the Agent SDK are the real ones.

const FOCUS_SETTINGS = '{"viewMode":"focus","tui":"fullscreen"}';

const sessionOf = async (server: TestServer, sessionId: string) =>
  (await server.state()).workspaces
    .flatMap((workspace) => workspace.sessions)
    .find((session) => session.id === sessionId);

/** The conversation ID the Agent's Claude Code was started with. */
function agentConversation(fakeClaude: FakeClaude): string | undefined {
  for (const entry of fakeClaude.received()) {
    if (entry.kind !== "start") continue;
    const flag = entry.argv.find((arg) => arg.startsWith("--session-id="));
    if (flag) return flag.split("=")[1];
  }
  return undefined;
}

describe("Open in terminal", () => {
  it("from Idle ends the runtime and runs `claude --resume` on the same conversation with the same Launch options, in the same Session, and Restart keeps it in the terminal", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id, {
      claude: { model: "opus", advisor: "off", focusView: true },
    });
    const agent = await server.openAgent(session.id);
    await agent.sync();
    agent.prompt("before");
    await agent.waitForEntry(isResult, "the answer");
    const conversation = agentConversation(instance.fakeClaude);
    expect(conversation).toBeTruthy();

    const response = await server.post(`/api/sessions/${session.id}/open-in-terminal`);

    expect(response.status).toBe(200);
    expect(await agent.waitForClose()).toBe(4410);
    expect(await sessionOf(server, session.id)).toMatchObject({
      id: session.id,
      kind: "claude",
      interface: "tui",
      status: "running",
    });
    expect(tmuxSessionNames(instance.config.tmuxSocket)).toHaveLength(1);
    const terminal = await server.openTerminal(session.id);
    expect(await fakeClaudeArgs(terminal)).toEqual([
      "--resume",
      conversation,
      "--model",
      "opus",
      "--settings",
      FOCUS_SETTINGS,
    ]);
    expect(terminal.output).toContain("advisor tool disabled: 1");
    expect(terminal.output).not.toContain("No conversation found");

    // After the Host restarts, Restart resumes in the interface last used.
    killTmuxServer(instance.config.tmuxSocket);
    await pollUntil(
      async () => (await sessionOf(server, session.id))?.status === "stopped",
      {
        description: "the Session to be Stopped",
      },
    );
    await server.post(`/api/sessions/${session.id}/restart`);
    const again = await server.openTerminal(session.id);
    expect((await fakeClaudeArgs(again)).slice(0, 2)).toEqual(["--resume", conversation]);
    expect((await sessionOf(server, session.id))?.interface).toBe("tui");
  });

  it("from Stopped starts straight in the terminal", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const agent = await server.openAgent(session.id);
    await agent.sync();
    agent.prompt("before");
    await agent.waitForEntry(isResult, "the answer");
    await server.post(`/api/sessions/${session.id}/stop`);
    expect((await sessionOf(server, session.id))?.status).toBe("stopped");

    const response = await server.post(`/api/sessions/${session.id}/open-in-terminal`);

    expect(response.status).toBe(200);
    expect(await sessionOf(server, session.id)).toMatchObject({
      interface: "tui",
      status: "running",
    });
    const terminal = await server.openTerminal(session.id);
    expect((await fakeClaudeArgs(terminal))[0]).toBe("--resume");
  });

  it("is refused for a shell, for a Session already in the terminal, and for an unknown one", async () => {
    const { server, workspace } = await boot();
    const shell = await server.createSession(workspace.id);
    const tui = await server.createClaudeSession(workspace.id);

    expect((await server.post(`/api/sessions/${shell.id}/open-in-terminal`)).status).toBe(
      422,
    );
    expect((await server.post(`/api/sessions/${tui.id}/open-in-terminal`)).status).toBe(
      422,
    );
    expect((await server.post("/api/sessions/nope/open-in-terminal")).status).toBe(404);
  });

  it("leaves nothing behind when the Session is deleted afterwards", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    await server.post(`/api/sessions/${session.id}/open-in-terminal`);
    const folder = agentFolder(instance.config.dataDir, session.id);
    expect(existsSync(folder)).toBe(true);

    await server.delete(`/api/sessions/${session.id}`);

    expect(existsSync(folder)).toBe(false);
  });
});
