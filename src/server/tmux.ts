import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import * as pty from "node-pty";

const execFileAsync = promisify(execFile);

/** Every Session is a tmux session named `kb-<session id>` on the instance's socket. */
const PREFIX = "kb-";

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
  ];
}

export interface TerminalAttachment {
  /** Output bytes from the Session. */
  onData(listener: (data: Buffer) => void): void;
  onExit(listener: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Detaches this client. The Session itself keeps running. */
  detach(): void;
}

/** Hides every tmux command line behind Session-shaped operations. */
export class TmuxDriver {
  private readonly socket: string;
  /** Per Session, the attachment whose input tmux last sized the window for. */
  private readonly lastTyper = new Map<string, object>();

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

  /** IDs of the Sessions whose shell is currently alive on this socket. */
  async listSessions(): Promise<string[]> {
    let stdout: string;
    try {
      stdout = await this.run(["list-sessions", "-F", "#{session_name}"]);
    } catch (error) {
      if (isNoServer(error)) return [];
      throw error;
    }
    return stdout
      .split("\n")
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length));
  }

  /** The size of the Session's window, which is what its shell sees. */
  private async windowSize(id: string): Promise<{ cols: number; rows: number }> {
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

  /**
   * With `window-size latest` tmux resizes the window to the client that last sent a key,
   * but only after it has read that key, and the shell can read the same key first. So when
   * a different client starts typing, its first character goes in alone and the rest waits
   * until the window has taken that client's size.
   */
  private async writeSizedToTyper(
    id: string,
    typer: object,
    size: () => { cols: number; rows: number },
    write: (data: string) => void,
    data: string,
  ): Promise<void> {
    if (this.lastTyper.get(id) === typer) return write(data);
    this.lastTyper.set(id, typer);
    const wanted = size();
    const same = (a: { cols: number; rows: number }) =>
      a.cols === wanted.cols && a.rows === wanted.rows;
    try {
      if (same(await this.windowSize(id))) return write(data);
      const [first = "", ...rest] = data;
      write(first);
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (same(await this.windowSize(id))) break;
      }
      if (rest.length > 0) write(rest.join(""));
    } catch {
      // The Session went away while we were waiting; the attachment's exit reports that.
      write(data);
    }
  }

  /** Attaches a pty client to the Session; tmux redraws the full current screen. */
  attach(id: string, size: { cols: number; rows: number }): TerminalAttachment {
    const process = pty.spawn(
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
    const typer = {};
    let current = { ...size };
    let queue: Promise<void> = Promise.resolve();
    return {
      onData: (listener) => {
        process.onData((data) => listener(Buffer.from(data as unknown as Uint8Array)));
      },
      onExit: (listener) => {
        process.onExit(() => listener());
      },
      write: (data) => {
        // Serialised, so a wait for tmux to resize never reorders what the owner typed.
        queue = queue
          .then(() =>
            this.writeSizedToTyper(id, typer, () => current, (d) => process.write(d), data),
          )
          .catch(() => {}); // the pty is gone; its exit is reported separately
      },
      resize: (cols, rows) => {
        current = { cols, rows };
        process.resize(cols, rows);
      },
      detach: () => {
        if (this.lastTyper.get(id) === typer) this.lastTyper.delete(id);
        process.kill();
      },
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
  return isNoServer(error) || stderrOf(error).includes("can't find session");
}
