import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import * as pty from "node-pty";

const execFileAsync = promisify(execFile);

/** Every Session is a tmux session named `kb-<session id>` on the instance's socket. */
const PREFIX = "kb-";

/** The Session-scoped tmux user option that holds a Session's Bell; set means rung. */
const BELL_OPTION = "@kb-bell";

/** A Session whose shell is alive, with its Bell. */
export interface LiveSession {
  id: string;
  bell: boolean;
}

/** Applied to the instance's tmux server whenever a Session is created (idempotent). */
function serverConfiguration(): string[][] {
  return [
    // tmux starts this as a login shell, so the owner's PATH and aliases are present
    // even though launchd provides a bare environment.
    ["set", "-g", "default-shell", userInfo().shell || "/bin/zsh"],
    ["set", "-g", "default-terminal", "tmux-256color"],
    ["set", "-g", "status", "off"],
    ["set", "-g", "mouse", "on"],
    ["set", "-g", "set-clipboard", "on"],
    ["set", "-g", "terminal-features[100]", "xterm*:clipboard"],
    ["set", "-g", "history-limit", "50000"],
    ["set", "-g", "window-size", "latest"],
    ["setw", "-g", "monitor-bell", "on"],
    ["set", "-g", "bell-action", "any"],
    // The Bell (ADR-0002: it lives in tmux, so it survives a k-bench restart and is raised
    // with no browser attached). tmux runs this hook for the Session that rang, even with no
    // client attached; it records the bell in a Session-scoped user option. A Session with a
    // client attached is being viewed, so its bell is not unseen and nothing is recorded.
    [
      "set-hook",
      "-g",
      "alert-bell",
      `if-shell -F "#{==:#{session_attached},0}" "set-option ${BELL_OPTION} 1"`,
    ],
  ];
}

/** A terminal's size in character cells. */
export interface Size {
  cols: number;
  rows: number;
}

/** A tmux client attached to one Session under a pty: a bare handle with no state. */
export interface TmuxClient {
  /** Output bytes from the Session. */
  onData(listener: (data: Buffer) => void): void;
  /** The client exited: it detached, or the Session's shell ended. */
  onExit(listener: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Signals the client (SIGHUP by default, which detaches it). The Session keeps running. */
  kill(signal?: NodeJS.Signals): void;
}

/**
 * Hides every tmux command line behind Session-shaped operations. It holds no state of its
 * own: everything it knows about a Session it asks tmux (ADR-0002).
 */
export class TmuxDriver {
  private readonly socket: string;

  constructor(socket: string) {
    this.socket = socket;
  }

  private env(): NodeJS.ProcessEnv {
    // A k-bench server started from inside a tmux pane must not think it is nested.
    const { TMUX: _tmux, TMUX_PANE: _pane, ...env } = process.env;
    return env;
  }

  private baseArgs(): string[] {
    return ["-u", "-L", this.socket];
  }

  private async run(...commands: string[][]): Promise<string> {
    const args = [...this.baseArgs()];
    commands.forEach((command, index) => {
      if (index > 0) args.push(";");
      args.push(...command);
    });
    const { stdout } = await execFileAsync("tmux", args, { env: this.env() });
    return stdout;
  }

  /** Starts a shell for the Session in `folder`, configuring the tmux server as needed. */
  async createSession(id: string, folder: string): Promise<void> {
    await this.run(...serverConfiguration(), [
      "new-session",
      "-d",
      "-s",
      PREFIX + id,
      "-c",
      folder,
    ]);
  }

  async killSession(id: string): Promise<void> {
    try {
      await this.run(["kill-session", "-t", `=${PREFIX}${id}`]);
    } catch (error) {
      if (!isNoSuchSession(error)) throw error;
    }
  }

  /** Marks the Session's Bell as seen. */
  async clearBell(id: string): Promise<void> {
    try {
      await this.run(["set-option", "-u", "-t", `=${PREFIX}${id}:`, BELL_OPTION]);
    } catch (error) {
      if (!isNoSuchSession(error)) throw error;
    }
  }

  /** The Sessions whose shell is currently alive on this socket, with their Bells. */
  async listSessions(): Promise<LiveSession[]> {
    let stdout: string;
    try {
      stdout = await this.run([
        "list-sessions",
        "-F",
        `#{session_name} #{${BELL_OPTION}}`,
      ]);
    } catch (error) {
      if (isNoServer(error)) return [];
      throw error;
    }
    return stdout
      .split("\n")
      .filter((line) => line.startsWith(PREFIX))
      .map((line) => {
        const [name = "", bell = ""] = line.split(" ");
        return { id: name.slice(PREFIX.length), bell: bell !== "" };
      });
  }

  /** The size of the Session's window, which is what its shell sees. */
  async windowSize(id: string): Promise<Size> {
    const out = await this.run([
      "display-message",
      "-p",
      "-t",
      `=${PREFIX}${id}`,
      "#{window_width} #{window_height}",
    ]);
    const [cols, rows] = out.trim().split(" ").map(Number);
    return { cols: cols ?? 0, rows: rows ?? 0 };
  }

  /** Starts a tmux client attached to the Session under a pty; tmux redraws the full screen. */
  spawnClient(id: string, size: Size): TmuxClient {
    const client = pty.spawn(
      "tmux",
      [...this.baseArgs(), "attach-session", "-t", `=${PREFIX}${id}`],
      {
        name: "xterm-256color",
        cols: size.cols,
        rows: size.rows,
        env: this.env() as Record<string, string>,
        encoding: null,
      },
    );
    return {
      onData: (listener) => {
        client.onData((data) => listener(Buffer.from(data as unknown as Uint8Array)));
      },
      onExit: (listener) => {
        client.onExit(() => listener());
      },
      write: (data) => client.write(data),
      resize: (cols, rows) => client.resize(cols, rows),
      kill: (signal) => client.kill(signal),
    };
  }
}

function stderrOf(error: unknown): string {
  return String((error as { stderr?: unknown }).stderr ?? "");
}

function isNoServer(error: unknown): boolean {
  const stderr = stderrOf(error);
  return stderr.includes("no server running") || stderr.includes("error connecting to");
}

function isNoSuchSession(error: unknown): boolean {
  return (
    isNoServer(error) ||
    stderrOf(error).includes("can't find") ||
    stderrOf(error).includes("no such session")
  );
}
