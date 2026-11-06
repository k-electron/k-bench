import { describe, expect, it } from "vitest";
import { fakeClaudeArgs } from "./harness/fake-claude.ts";
import { createTestInstance, type TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

// What reaches Claude Code is the contract with it (ADR-0005), so these tests read the flags
// and the environment the stub (test/harness/fake-claude.sh) was started with.

const FOCUS_SETTINGS = '{"viewMode":"focus","tui":"fullscreen"}';

async function boot() {
  const instance = createTestInstance();
  const server = await instance.start();
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  return { instance, server, workspace };
}

/** Launches a Claude Session with the options and returns what the stub was started with. */
async function launch(
  server: TestServer,
  workspaceId: string,
  claude: Record<string, unknown>,
) {
  const session = await server.createClaudeSession(workspaceId, { claude });
  const terminal = await server.openTerminal(session.id);
  const args = await fakeClaudeArgs(terminal);
  return {
    session,
    terminal,
    /** The arguments after `--session-id <conversation ID>`. */
    flags: args.slice(2),
    advisorDisabled: terminal.output.includes("advisor tool disabled: 1"),
  };
}

const DEFAULTS = { model: "default", effort: "default", advisor: "default" };

describe("Launch options", () => {
  it("add no flag for Default", async () => {
    const { server, workspace } = await boot();

    const { flags, advisorDisabled } = await launch(server, workspace.id, {
      ...DEFAULTS,
      focusView: false,
    });

    expect(flags).toEqual([]);
    expect(advisorDisabled).toBe(false);
  });

  it("pass an explicit model, effort and advisor as flags", async () => {
    const { server, workspace } = await boot();

    const { flags, advisorDisabled } = await launch(server, workspace.id, {
      model: "opus",
      effort: "xhigh",
      advisor: "sonnet",
      focusView: false,
    });

    expect(flags).toEqual([
      "--model",
      "opus",
      "--effort",
      "xhigh",
      "--advisor",
      "sonnet",
    ]);
    expect(advisorDisabled).toBe(false);
  });

  it("turn the advisor off with the environment, not a flag", async () => {
    const { server, workspace } = await boot();

    const { flags, advisorDisabled } = await launch(server, workspace.id, {
      ...DEFAULTS,
      advisor: "off",
      focusView: false,
    });

    expect(advisorDisabled).toBe(true);
    expect(flags).toEqual([]);
  });

  it("start Focus view with both settings as one argument, and nothing else", async () => {
    const { server, workspace } = await boot();

    const { flags } = await launch(server, workspace.id, {
      ...DEFAULTS,
      focusView: true,
    });

    expect(flags).toEqual(["--settings", FOCUS_SETTINGS]);
  });

  it("are refused when a value is unknown, naming the field, and create no Session", async () => {
    const { server, workspace } = await boot();
    const valid = { ...DEFAULTS, focusView: false };
    const refused: Array<[string, Record<string, unknown>]> = [
      ["claude.model", { ...valid, model: "gpt-9" }],
      ["claude.effort", { ...valid, effort: "extreme" }],
      // Haiku is a model, not an advisor.
      ["claude.advisor", { ...valid, advisor: "haiku" }],
      ["claude.focusView", { ...valid, focusView: "yes" }],
    ];

    for (const [field, claude] of refused) {
      const response = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
        claude,
      });
      expect(response.status, field).toBe(422);
      expect(((await response.json()) as { error: string }).error, field).toContain(
        field,
      );
    }

    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
  });

  it("survive a k-bench restart: the Session started again launches with them", async () => {
    const { instance, server, workspace } = await boot();
    const first = await launch(server, workspace.id, {
      model: "haiku",
      effort: "low",
      advisor: "off",
      focusView: true,
    });
    await server.stop();
    const restarted = await instance.start();
    // The Session outlived the server; now Claude Code quits, and the Session is restarted.
    const terminal = await restarted.openTerminal(first.session.id);
    terminal.run("exit 0");
    await pollUntil(
      async () =>
        (await restarted.state()).workspaces[0]?.sessions[0]?.status === "stopped",
      { description: "the Session to be Stopped" },
    );

    const response = await restarted.post(`/api/sessions/${first.session.id}/restart`);

    expect(response.status).toBe(200);
    // Nothing was typed, so the resume found no conversation and a fresh start followed.
    const again = await restarted.openTerminal(first.session.id);
    expect((await fakeClaudeArgs(again)).slice(2)).toEqual([
      "--model",
      "haiku",
      "--effort",
      "low",
      "--settings",
      FOCUS_SETTINGS,
    ]);
    expect(again.output).toContain("advisor tool disabled: 1");
  });
});
