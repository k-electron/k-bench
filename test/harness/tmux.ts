import { execFileSync } from "node:child_process";

/**
 * Direct access to a test instance's tmux server, for what the API cannot do: simulating a
 * Host reboot, and planting or looking for tmux sessions the store knows nothing about.
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
 * Detaches every client from every Session, as a browser tab vanishing would. The Sessions
 * keep running, with nobody attached.
 */
export function detachAllClients(socket: string): void {
  for (const client of tmux(socket, "list-clients", "-F", "#{client_name}").split("\n")) {
    if (client) tmux(socket, "detach-client", "-t", client);
  }
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
