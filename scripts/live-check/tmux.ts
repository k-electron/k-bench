// A Claude TUI in a tmux server of the live check's own (`-L kb-livecheck-<run id>`, no
// configuration file), driven by keystrokes and read by polling the pane for text. Never the
// owner's `k-bench` socket. Killed when the check ends, or aborts.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { killGroup } from "./session.ts";

const PANE = "t";

/** `'` quoting for a shell command line. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export class Tmux {
  readonly socket: string;
  private readonly env: NodeJS.ProcessEnv;
  private started = false;
  private pids = new Set<number>();

  constructor(runId: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
    this.socket = `kb-livecheck-${runId}`;
    this.env = env;
    // An abort (a rail broken, Ctrl-C) ends the terminal at once.
    signal?.addEventListener("abort", () => this.kill(), { once: true });
  }

  private tmux(args: string[]): string {
    return execFileSync("tmux", ["-L", this.socket, "-f", "/dev/null", ...args], {
      env: this.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /** Starts `command` (one shell command line) in a pane of 200 by 50, in `cwd`. Returns the pane process's ID. */
  start(command: string, cwd: string): number | undefined {
    this.tmux([
      "new-session",
      "-d",
      "-s",
      PANE,
      "-x",
      "200",
      "-y",
      "50",
      "-c",
      cwd,
      command,
    ]);
    this.started = true;
    const pid = Number(this.tmux(["list-panes", "-t", PANE, "-F", "#{pane_pid}"]).trim());
    if (Number.isInteger(pid) && pid > 0) {
      this.pids.add(pid);
      return pid;
    }
    return undefined;
  }

  /** Whether the pane's program is still running. */
  alive(): boolean {
    if (!this.started) return false;
    try {
      return this.tmux(["list-panes", "-t", PANE, "-F", "#{pane_dead}"]).trim() === "0";
    } catch {
      return false;
    }
  }

  /** Named keys (`Enter`, `Escape`, `Up`, `BTab`, `C-c`). */
  keys(...keys: string[]): void {
    this.tmux(["send-keys", "-t", PANE, ...keys]);
  }

  /** Text as typed, with no key name read into it. */
  type(text: string): void {
    this.tmux(["send-keys", "-t", PANE, "-l", text]);
    // The real TUI reads text that arrives all at once as a paste, and an Enter straight after it
    // as a line break inside the paste, not a submit (found by hand: with a second's pause it
    // submits). So typing is followed by a short pause.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
  }

  /** The screen as it is now: no scrollback, where old dialogs and labels linger. */
  capture(): string {
    try {
      return this.tmux(["capture-pane", "-p", "-t", PANE]);
    } catch {
      return "";
    }
  }

  /** The pane's text once `match` finds it, polling; undefined after `timeoutMs`. */
  async waitFor(
    match: RegExp | ((text: string) => boolean),
    timeoutMs: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<string | undefined> {
    const test = (text: string) =>
      typeof match === "function" ? match(text) : match.test(text);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = this.capture();
      if (test(text)) return text;
      if (!this.started || Date.now() >= deadline || options.signal?.aborted)
        return undefined;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  /** Ends the pane's program and the tmux server, and everything either started. */
  kill(): void {
    if (!this.started) return;
    try {
      this.tmux(["kill-server"]);
    } catch {
      // Already gone.
    }
    for (const pid of this.pids) killGroup(pid);
    // A server that ended by itself can leave its socket file: this one's own name only.
    rmSync(
      join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${process.getuid?.()}`, this.socket),
      {
        force: true,
      },
    );
    this.started = false;
  }
}

/** The first truthy value `check` returns, polled; undefined after `timeoutMs` or when `signal` aborts. */
export async function until<T>(
  check: () => T | undefined | false | null,
  timeoutMs: number,
  options: { everyMs?: number; signal?: AbortSignal } = {},
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() >= deadline || options.signal?.aborted) return undefined;
    await new Promise((resolve) => setTimeout(resolve, options.everyMs ?? 300));
  }
}
