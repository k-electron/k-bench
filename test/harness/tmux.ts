import { execFileSync } from "node:child_process";

/**
 * Direct access to a test instance's tmux server, for what the API cannot do: simulating a
 * Host reboot, and planting or looking for tmux sessions the store knows nothing about.
 * Every function refuses a socket that is not a throwaway test socket, so none of them can
 * reach the Installed or Dev instance.
 */

function tmux(socket: string, ...args: string[]): string {
  if (!socket.startsWith("kb-test-")) {
    throw new Error(`refusing to touch tmux socket ${socket}`);
  }
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
