import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import {
  fakeClaudeArgs,
  fakeClaudeConversation,
  fakeClaudeSavedConversations,
  fakeClaudeSettings,
  ignoreClaudeSettings,
} from "./harness/fake-claude.ts";
import type { TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import type { TerminalClient } from "./harness/terminal.ts";
import { typeIntoSession } from "./harness/tmux.ts";

// A Claude Session resumes the Claude conversation last running in it. Inside Claude Code the
// owner can move to another conversation (/clear, /resume, /branch); the fake Claude Code's
// `clear` stands for all of them.

/** Runs `clear` in the fake Claude Code and returns the conversation it moved to. */
async function clear(terminal: TerminalClient): Promise<string> {
  const before = fakeClaudeConversation(terminal);
  terminal.run("clear");
  return pollUntil(
    () => {
      const now = fakeClaudeConversation(terminal);
      return now !== before ? now : undefined;
    },
    { description: "the fake Claude Code to report a new conversation" },
  );
}

/**
 * Quits Claude Code, waits for its Session to end, and restarts it. Nothing here reads the
 * state, as no browser is viewing the Session: what the restart resumes was saved by k-bench
 * following the conversation on its own.
 */
async function quitAndRestart(
  server: TestServer,
  sessionId: string,
  terminal: TerminalClient,
) {
  terminal.run("exit 0");
  await terminal.waitForEnded();
  const response = await server.post(`/api/sessions/${sessionId}/restart`);
  expect(response.status).toBe(200);
  return server.openTerminal(sessionId);
}

describe("A Claude Session follows its conversation", () => {
  it("resumes the conversation it moved to, not the one it was launched with", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    const [, launched] = await fakeClaudeArgs(terminal);

    const moved = await clear(terminal);
    terminal.run("a first message, so the new conversation is saved");
    await terminal.waitForOutput("claude-stub heard:");

    const again = await quitAndRestart(server, claude.id, terminal);

    expect(moved).not.toBe(launched);
    expect(await fakeClaudeArgs(again)).toEqual(["--resume", moved]);
  });

  it("keeps the conversation it moved to while k-bench was down, across a k-bench restart", async () => {
    const { instance, server, workspace } = await boot();
    const program = instance.config.claudeProgram;
    const claude = await server.createClaudeSession(workspace.id);
    const first = await server.openTerminal(claude.id);
    const [, launched] = await fakeClaudeArgs(first);
    await server.stop();

    // Typed with k-bench down: the move is reported while nothing is listening.
    typeIntoSession(instance.config.tmuxSocket, claude.id, "clear");
    typeIntoSession(instance.config.tmuxSocket, claude.id, "a first message");
    const moved = await pollUntil(() => fakeClaudeSavedConversations(program)[0], {
      description: "the new conversation to be saved",
    });
    const restarted = await instance.start();
    const terminal = await restarted.openTerminal(claude.id);
    await terminal.waitForOutput("claude-stub heard:");

    const again = await quitAndRestart(restarted, claude.id, terminal);

    expect(moved).not.toBe(launched);
    expect(await fakeClaudeArgs(again)).toEqual(["--resume", moved]);
  });

  it("starts the conversation it moved to afresh when it never had a message, and keeps following", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    await fakeClaudeArgs(terminal);
    const moved = await clear(terminal);

    const again = await quitAndRestart(server, claude.id, terminal);

    expect(await fakeClaudeArgs(again)).toEqual(["--session-id", moved]);
    expect(again.output).toContain("No conversation found");
    expect(again.output).not.toContain("exited with an error");
    // The restarted Claude Code is followed too.
    const movedAgain = await clear(again);
    again.run("a first message");
    await again.waitForOutput("claude-stub heard:");
    const third = await quitAndRestart(server, claude.id, again);
    expect(await fakeClaudeArgs(third)).toEqual(["--resume", movedAgain]);
  });

  it("resumes the conversation it was launched with when Claude Code runs no hooks", async () => {
    const { instance, server, workspace } = await boot();
    ignoreClaudeSettings(instance.config.claudeProgram);
    const claude = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(claude.id);
    const [, launched] = await fakeClaudeArgs(terminal);
    terminal.run("a message in the first conversation");
    await terminal.waitForOutput("claude-stub heard:");
    await clear(terminal);
    terminal.run("a message in the second conversation");
    await terminal.waitForOutput("claude-stub heard: a message in the second");

    const again = await quitAndRestart(server, claude.id, terminal);

    expect(await fakeClaudeArgs(again)).toEqual(["--resume", launched]);
  });

  it("keeps Focus view on when it was chosen, after following a conversation", async () => {
    const { server, workspace } = await boot();
    const claude = await server.createClaudeSession(workspace.id, {
      claude: { focusView: true },
    });
    const terminal = await server.openTerminal(claude.id);
    await fakeClaudeArgs(terminal);
    const moved = await clear(terminal);
    terminal.run("a first message");
    await terminal.waitForOutput("claude-stub heard:");

    const again = await quitAndRestart(server, claude.id, terminal);

    expect(await fakeClaudeArgs(again)).toEqual(["--resume", moved]);
    expect(await fakeClaudeSettings(again)).toEqual({
      theme: "dark",
      viewMode: "focus",
      tui: "fullscreen",
    });
  });
});
