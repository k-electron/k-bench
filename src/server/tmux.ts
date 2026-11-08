import { execFile, spawn } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { type ClaudeLaunch, claudeCommand } from "./claude.ts";

const execFileAsync = promisify(execFile);

/** Every Session is a tmux session named `kb-<session id>` on the instance's socket. */
const PREFIX = "kb-";

/** The Session-scoped tmux user option that holds a Session's Bell; set means rung. */
const BELL_OPTION = "@kb-bell";
/** The tmux `wait-for` channel signalled whenever a Bell may have been raised or cleared. */
const BELL_CHANNEL = "kb-bell-changed";
/** How long a Bell watch waits before trying again after tmux failed it unexpectedly. */
const BELL_WATCH_RETRY_MS = 1_000;

/** A Session whose shell is alive, with its Bell. */
export interface LiveSession {
  id: string;
  bell: boolean;
}

/** The owner's login shell. */
function ownerShell(): string {
  return userInfo().shell || "/bin/zsh";
}

/**
 * What a Session's pane runs: the owner's shell as a login shell, so their PATH and aliases
 * are present even though launchd provides a bare environment, started in `folder`.
 *
 * The `cd` is needed as well as `new-session -c`: tmux ignores `-c` once the tmux server's own
 * working directory has been deleted, and the shell then starts in that deleted folder. That
 * happens to every server an earlier install started, because upgrading deletes the old app
 * folder, which is the launchd working directory. The folder and shell are passed as
 * arguments, never spliced into the script, so no folder name can break or inject into it.
 * The `cd` runs in zsh with no startup files, not /bin/sh: macOS's /bin/sh is bash, which
 * prints a `getcwd` error when it starts in a deleted folder. A failed `cd` (the folder
 * vanished just now) still starts the shell, as tmux alone would have.
 */
function sessionCommand(folder: string): string[] {
  return [
    "/bin/zsh",
    "-f",
    "-c",
    'cd -- "$1"; exec "$2" -l',
    "zsh",
    folder,
    ownerShell(),
  ];
}

/** Binds a wheel key in a copy-mode table to scroll one line, as tmux's default does five. */
function scrollOneLine(table: string, key: string, command: string): string[] {
  return ["bind-key", "-T", table, key, "select-pane", "\\;", "send-keys", "-X", command];
}

/** Applied to the instance's tmux server whenever a Session is created (idempotent). */
function serverConfiguration(): string[][] {
  return [
    // The shell for any pane tmux starts without a command of its own (`sessionCommand`).
    ["set", "-g", "default-shell", ownerShell()],
    ["set", "-g", "default-terminal", "tmux-256color"],
    ["set", "-g", "status", "off"],
    ["set", "-g", "mouse", "on"],
    ["set", "-g", "set-clipboard", "on"],
    ["set", "-g", "terminal-features[100]", "xterm*:clipboard"],
    ["set", "-g", "history-limit", "50000"],
    // One line of History per wheel report, so a phone's swipe can follow the finger line
    // by line. The web app sends several reports per desktop wheel step to keep that feel
    // (`web/src/wheelReports.ts`).
    ...["copy-mode", "copy-mode-vi"].flatMap((table) => [
      scrollOneLine(table, "WheelUpPane", "scroll-up"),
      scrollOneLine(table, "WheelDownPane", "scroll-down"),
    ]),
    ["set", "-g", "window-size", "latest"],
    ["setw", "-g", "monitor-bell", "on"],
    ["set", "-g", "bell-action", "any"],
    // The Bell, and the one place that decides what viewing a Session means for it: a tmux
    // client attached to it, which is what a browser terminal is. It lives in tmux (ADR-0002),
    // so it survives a k-bench restart and is raised with no browser attached. tmux runs
    // these hooks in its own single thread, so no bell can slip between deciding and acting:
    // - a bell is recorded only while no client is attached to the Session that rang;
    // - a client attaching clears the Session's Bell, whenever it rang before.
    // Both signal the Bell channel, so the server can announce the change (`watchBells`).
    [
      "set-hook",
      "-g",
      "alert-bell",
      `if-shell -F "#{==:#{session_attached},0}" { set-option ${BELL_OPTION} 1 ; wait-for -S ${BELL_CHANNEL} }`,
    ],
    [
      "set-hook",
      "-g",
      "client-attached",
      `set-option -u ${BELL_OPTION} ; wait-for -S ${BELL_CHANNEL}`,
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

/** A running watch on the Bells (`TmuxDriver.watchBells`). */
export interface BellWatch {
  /** Stops watching; resolves once nothing is left waiting on tmux. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Hides every tmux command line behind Session-shaped operations. It holds no state about
 * Sessions: everything it knows about one it asks tmux (ADR-0002).
 */
export class TmuxDriver {
  private readonly socket: string;
  /** Bell watches, which a new tmux server must wake (see `watchBells`). */
  private readonly bellWatches = new Set<BellWatcher>();

  /** The program a Claude Session runs (`InstanceConfig.claudeProgram`). */
  private readonly claudeProgram: string;

  constructor(socket: string, claudeProgram = "claude") {
    this.socket = socket;
    this.claudeProgram = claudeProgram;
  }

  private env(): NodeJS.ProcessEnv {
    // A k-bench server started from inside a tmux pane must not think it is nested, and
    // one started by Claude Code (a Dev instance an agent runs) must not hand Claude Code's
    // own session variables, such as CLAUDE_CODE_DISABLE_ADVISOR_TOOL, to every Session.
    // The owner's own settings come back from their login shell, which each Session runs.
    const { TMUX: _tmux, TMUX_PANE: _pane, ...env } = process.env;
    for (const name of Object.keys(env)) {
      if (name === "CLAUDECODE" || name.startsWith("CLAUDE_")) delete env[name];
    }
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

  /**
   * Starts the Session in `folder`, configuring the tmux server as needed: the owner's shell,
   * or, given `claude`, Claude Code.
   */
  async createSession(id: string, folder: string, claude?: ClaudeLaunch): Promise<void> {
    const command = claude
      ? claudeCommand({
          folder,
          shell: ownerShell(),
          program: this.claudeProgram,
          launch: claude,
        })
      : sessionCommand(folder);
    await this.run(...serverConfiguration(), [
      "new-session",
      "-d",
      "-s",
      PREFIX + id,
      "-c",
      folder,
      "--",
      ...command,
    ]);
    // This may have started the tmux server, which a Bell watch idles without.
    for (const watch of this.bellWatches) watch.serverStarted();
  }

  /**
   * Applies the configuration to a tmux server that is already running, such as one a
   * previous version of k-bench configured. Does nothing when no tmux server is running.
   */
  async configure(): Promise<void> {
    try {
      await this.run(...serverConfiguration());
    } catch (error) {
      if (!isNoServer(error)) throw error;
    }
  }

  /**
   * Calls `onChange` soon after any Session's Bell is raised or cleared (and now and then
   * when nothing changed), until stopped. Changes are missed only while no tmux server runs,
   * when there are no Bells to change.
   */
  watchBells(onChange: () => void): BellWatch {
    const watch = new BellWatcher(
      [...this.baseArgs(), "wait-for", BELL_CHANNEL],
      this.env(),
      {
        onChange,
        onStop: () => this.bellWatches.delete(watch),
      },
    );
    this.bellWatches.add(watch);
    watch.start();
    return watch;
  }

  async killSession(id: string): Promise<void> {
    try {
      await this.run(["kill-session", "-t", `=${PREFIX}${id}`]);
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

  /**
   * The size the Session's shell sees: that of its tmux pane's terminal. tmux resizes that
   * terminal some time after the window (at most once every 250ms per tmux pane), so the
   * window's size can be ahead of it. tmux names the terminal; `stty` reads its size.
   */
  async shellSize(id: string): Promise<Size> {
    const tmuxPaneTty = (
      await this.run([
        "display-message",
        "-p",
        "-t",
        // The trailing colon names the Session's current window. Without it tmux 3.8
        // finds no window and prints an empty value, without failing.
        `=${PREFIX}${id}:`,
        "#{pane_tty}",
      ])
    ).trim();
    // `-f` is the macOS spelling (the Host is a Mac); it prints "<rows> <cols>".
    const { stdout } = await execFileAsync("stty", ["-f", tmuxPaneTty, "size"]);
    const [rows, cols] = stdout.trim().split(" ").map(Number);
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

/**
 * Waits on the Bell channel with a `tmux wait-for` client, again and again. tmux keeps a
 * signal sent while nobody is waiting for the next wait, so none is lost between two waits.
 * With no tmux server to wait on, it idles until told one has started.
 */
class BellWatcher implements BellWatch {
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly onChange: () => void;
  private readonly onStop: () => void;
  private waiting: { exited: Promise<void>; kill(): void } | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  /** No tmux server was running at the last wait: nothing is waiting, until one starts. */
  private idle = false;
  /** Bumped whenever a tmux server may have started, so a wait that found none retries. */
  private serverGeneration = 0;
  private stopping: Promise<void> | undefined;

  constructor(
    args: string[],
    env: NodeJS.ProcessEnv,
    handlers: { onChange: () => void; onStop: () => void },
  ) {
    this.args = args;
    this.env = env;
    this.onChange = handlers.onChange;
    this.onStop = handlers.onStop;
  }

  serverStarted(): void {
    this.serverGeneration++;
    if (this.idle || this.retry) this.start();
  }

  start(): void {
    clearTimeout(this.retry);
    this.retry = undefined;
    this.idle = false;
    if (this.stopping || this.waiting) return;
    const generation = this.serverGeneration;
    const child = spawn("tmux", this.args, {
      env: this.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    // A failure to spawn is reported by its own event, then as an exit like any other.
    child.on("error", () => undefined);
    const exited = new Promise<void>((resolve) => {
      child.on("close", (code) => {
        this.waiting = undefined;
        resolve();
        this.waitEnded(code === 0, stderr, generation);
      });
    });
    this.waiting = { exited, kill: () => child.kill() };
  }

  private waitEnded(signalled: boolean, stderr: string, generation: number): void {
    if (this.stopping) return;
    if (signalled) {
      this.start();
      this.onChange();
      return;
    }
    // A tmux server started while this wait was looking for one.
    if (generation !== this.serverGeneration) {
      this.start();
      return;
    }
    if (isNoServerMessage(stderr)) {
      this.idle = true;
    } else {
      // tmux failed the wait some other way, such as its server being killed under it.
      this.retry = setTimeout(() => this.start(), BELL_WATCH_RETRY_MS);
      this.retry.unref();
    }
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      clearTimeout(this.retry);
      this.onStop();
      const waiting = this.waiting;
      waiting?.kill();
      await waiting?.exited;
    })();
    return this.stopping;
  }
}

function stderrOf(error: unknown): string {
  return String((error as { stderr?: unknown }).stderr ?? "");
}

function isNoServer(error: unknown): boolean {
  return isNoServerMessage(stderrOf(error));
}

function isNoServerMessage(stderr: string): boolean {
  return (
    stderr.includes("no server running") ||
    stderr.includes("error connecting to") ||
    // The server was shutting down as the command reached it: its last Session had just
    // ended, which is no server at all a moment later.
    stderr.includes("server exited unexpectedly")
  );
}

function isNoSuchSession(error: unknown): boolean {
  return (
    isNoServer(error) ||
    stderrOf(error).includes("can't find") ||
    stderrOf(error).includes("no such session")
  );
}
