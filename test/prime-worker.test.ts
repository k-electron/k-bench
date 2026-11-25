import { describe, expect, it } from "vitest";
import type { SessionState } from "../src/shared/state-protocol.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { fakeClaudeArgs } from "./harness/fake-claude.ts";
import type { TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

async function sessionNamed(server: TestServer, name: string): Promise<SessionState> {
  const state = await server.state();
  const session = state.workspaces[0]?.sessions.find((s) => s.name === name);
  if (!session) throw new Error(`No Session named ${name}`);
  return session;
}

/** Starts a Stopped Session with Restart, and returns how the fake Claude Code was launched. */
async function restart(server: TestServer, sessionId: string) {
  const response = await server.post(`/api/sessions/${sessionId}/restart`);
  expect(response.status).toBe(200);
  const terminal = await server.openTerminal(sessionId);
  const [idFlag, conversationId, ...flags] = await fakeClaudeArgs(terminal);
  const settings = flags.indexOf("--settings");
  return {
    terminal,
    idFlag,
    conversationId,
    // Everything but the settings, which are checked by what they hold.
    flags: settings === -1 ? flags : flags.toSpliced(settings, 2),
    settings: settings === -1 ? undefined : JSON.parse(flags[settings + 1] as string),
    advisorDisabled: terminal.output.includes("advisor tool disabled: 1"),
  };
}

describe("A new Workspace's Prime and Worker", () => {
  it("are recorded with the Workspace, as Claude Sessions that are not started", async () => {
    const { server } = await boot();

    const sessions = (await server.state()).workspaces[0]?.sessions;

    expect(sessions).toEqual([
      expect.objectContaining({
        name: "Prime",
        role: "prime",
        kind: "claude",
        status: "stopped",
      }),
      expect.objectContaining({
        name: "Worker",
        role: "worker",
        kind: "claude",
        status: "stopped",
      }),
    ]);
  });

  it.each([
    { name: "Prime", flags: ["--model", "opus", "--effort", "high"], advisorOff: true },
    {
      name: "Worker",
      flags: ["--model", "sonnet", "--effort", "high", "--advisor", "opus"],
      advisorOff: false,
    },
  ])(
    "launch the $name with its fixed Launch options, starting and then resuming its recorded conversation",
    async ({ name, flags, advisorOff }) => {
      const { server } = await boot();
      const { id } = await sessionNamed(server, name);

      const first = await restart(server, id);
      first.terminal.run("hello");
      await first.terminal.waitForOutput("claude-stub heard: hello");
      first.terminal.run("exit 0");
      await pollUntil(
        async () => (await sessionNamed(server, name)).status === "stopped",
        {
          description: `the ${name} to be Stopped`,
        },
      );
      const again = await restart(server, id);

      for (const launch of [first, again]) {
        expect(launch.flags).toEqual(flags);
        expect(launch.settings).toMatchObject({ viewMode: "focus", tui: "fullscreen" });
        expect(launch.advisorDisabled).toBe(advisorOff);
      }
      expect(first.idFlag).toBe("--session-id");
      expect(again.idFlag).toBe("--resume");
      expect(again.conversationId).toBe(first.conversationId);
    },
  );

  it("can't be renamed or deleted, and lend their names to no other Session", async () => {
    const { server, workspace } = await boot();
    const prime = await sessionNamed(server, "Prime");
    const worker = await sessionNamed(server, "Worker");
    const other = await server.createSession(workspace.id, "build");

    const refusals = [
      await server.renameSession(prime.id, "planner"),
      await server.renameSession(worker.id, "doer"),
      await server.deleteSession(prime.id),
      await server.deleteSession(worker.id),
      await server.post(`/api/workspaces/${workspace.id}/sessions`, { name: "Prime" }),
      await server.post(`/api/workspaces/${workspace.id}/sessions`, {
        name: "Worker",
        claude: {},
      }),
      await server.renameSession(other.id, "Worker"),
    ];

    expect(refusals.map((response) => response.status)).toEqual(Array(7).fill(409));
    expect((await server.state()).workspaces[0]?.sessions).toMatchObject([
      { id: prime.id, name: "Prime", role: "prime" },
      { id: worker.id, name: "Worker", role: "worker" },
      { id: other.id, name: "build", role: null },
    ]);
  });
});
