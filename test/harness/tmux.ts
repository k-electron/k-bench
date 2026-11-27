import { execFileSync } from "node:child_process";
import {
  ACTIVITY_AT_OPTION,
  ACTIVITY_CHANNEL,
  ACTIVITY_OPTION,
} from "../../src/server/claude.ts";
import type { SessionActivity } from "../../src/shared/state-protocol.ts";

/**
 * Direct access to a test instance's tmux server, for what the API cannot do: simulating a
 * Host reboot, planting or looking for tmux sessions the store knows nothing about, waiting
 * until no terminal is viewing a Session, and setting a Claude Session's state.
 * Every function refuses a socket that is not a throwaway test socket, so none of them can
 * reach the Installed or Dev instance.
 */

function assertTestSocket(socket: string): void {
  if (!socket.startsWith("kb-test-")) {
    throw new Error(`refusing to touch tmux socket ${socket}`);
  }
}

function tmux(socket: string, ...args: string[]): string {
  assertTestSocket(socket);
  const { TMUX: _tmux, TMUX_PANE: _pane, ...env } = process.env;
  return execFileSync("tmux", ["-L", socket, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

/** Kills the whole tmux server, as a Host reboot does. Sessions' shells all die. */
export function killTmuxServer(socket: string): void {
  tmux(socket, "kill-server");
}

/** Starts a tmux session named `name` on the socket, with no store record anywhere. */
export function plantTmuxSession(socket: string, name: string): void {
  tmux(socket, "new-session", "-d", "-s", name);
}

/**
 * Types `text` and Enter into a Session's shell with no terminal attached, as a program
 * running in the background would. This is how a test rings a Bell nobody is watching.
 */
export function typeIntoSession(socket: string, sessionId: string, text: string): void {
  tmux(socket, "send-keys", "-t", `=kb-${sessionId}:`, "-l", text);
  tmux(socket, "send-keys", "-t", `=kb-${sessionId}:`, "Enter");
}

/**
 * Sets a running Claude Session's state as its Claude Code hooks do: stamps the time, writes
 * the state on its pane and signals the channel, all in one tmux call.
 */
export function setActivity(
  socket: string,
  sessionId: string,
  activity: SessionActivity,
): void {
  const pane = `=kb-${sessionId}:`;
  const now = String(Math.floor(Date.now() / 1000));
  tmux(
    socket,
    ...["set-option", "-p", "-t", pane, ACTIVITY_AT_OPTION, now, ";"],
    ...["set-option", "-p", "-t", pane, ACTIVITY_OPTION, activity, ";"],
    ...["wait-for", "-S", ACTIVITY_CHANNEL],
  );
}

/** How many tmux clients are attached to the Session: how many terminals are viewing it. */
export function attachedClientCount(socket: string, sessionId: string): number {
  // One line per client; what the line says does not matter.
  return tmux(socket, "list-clients", "-t", `=kb-${sessionId}`, "-F", "client")
    .split("\n")
    .filter(Boolean).length;
}

/** Names of the tmux sessions alive on the socket (empty when no tmux server runs). */
export function tmuxSessionNames(socket: string): string[] {
  try {
    return tmux(socket, "list-sessions", "-F", "#{session_name}")
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * How many tmux client processes for the socket are running, attached or still connecting.
 * This counts a client tmux has already let go of but that has not exited yet, too.
 */
export function tmuxClientProcessCount(socket: string): number {
  assertTestSocket(socket);
  try {
    return execFileSync("pgrep", ["-f", "--", `-L ${socket} attach-session`])
      .toString()
      .split("\n")
      .filter(Boolean).length;
  } catch {
    return 0; // pgrep exits 1 when nothing matches
  }
}
