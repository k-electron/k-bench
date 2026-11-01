import type { Size, TmuxClient, TmuxDriver } from "./tmux.ts";

/**
 * Why a terminal ended, told to its viewer:
 * - `session-ended`: the Session is unknown, not running, its shell exited, or it was deleted;
 * - `failed`: the tmux client could not be started;
 * - `server-stopping`: the server is stopping. The Session keeps running.
 */
export type EndReason = "session-ended" | "failed" | "server-stopping";

/** The browser side of one terminal, which the module shows output to. */
export interface Viewer {
  /** Output from the Session, in order. Only called while the tmux client is attached. */
  show(output: Buffer): void;
  /** Called at most once and last, and never after the viewer detached. */
  end(reason: EndReason): void;
}

/** One viewer's terminal on one Session. Every method is safe to call at any time. */
export interface Attachment {
  /**
   * Sends what the owner typed to the Session's shell, in order. Input sent before the tmux
   * client is attached waits for it. After detach or the end it does nothing.
   */
  input(data: string): void;
  /**
   * The viewer's size. Anything but whole numbers from 1 to 999 is ignored, so a caller can
   * pass on what a client sent without checking it.
   */
  resize(cols: number, rows: number): void;
  /** The viewer left: its tmux client goes away and the Session keeps running. Idempotent. */
  detach(): void;
}

/** What attaching needs from the Sessions. `Service` provides it. */
export interface Sessions {
  /** Whether there is a shell to attach to: a known Session that is running. */
  hasRunningShell(sessionId: string): Promise<boolean>;
  /** The owner has seen the Session: its Bell is cleared. */
  markSeen(sessionId: string): Promise<void>;
}

/** A terminal dimension a pty can take: a whole number from 1 to 999. */
function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) < 1000;
}

const DEFAULT_SIZE: Size = { cols: 80, rows: 24 };

/** How long a stop waits for detached tmux clients to exit before killing them outright. */
const CLIENT_EXIT_TIMEOUT_MS = 3_000;
/** How long a stop then waits for killed tmux clients to exit before giving up on them. */
const CLIENT_KILL_TIMEOUT_MS = 1_000;

/**
 * What a browser terminal sends by itself, not because the owner typed: answers to tmux's
 * device and cursor queries, and focus in/out.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences
const TERMINAL_REPORT = /^\x1b\[(?:[?>][\d;]*c|[IO]|\d+;\d+R)$/;

/**
 * Where a terminal is in its life, and the one record of whether its tmux client is alive:
 * - `looking-up`: the Session is being looked up and no tmux client exists yet;
 * - `attached`: the tmux client is running and relays input and output;
 * - `detaching`: the tmux client was told to go and has not exited yet;
 * - `gone`: no tmux client is running, and none will be started.
 * A terminal only moves forward through these.
 */
type Phase = "looking-up" | "attached" | "detaching" | "gone";

/**
 * Every browser terminal's life, from open to drained: looking up the Session, starting a
 * tmux client for it, relaying input and output, sizing the window to whoever typed last,
 * and detaching. `stop` drains them all.
 */
export class Attachments {
  private readonly context: TerminalContext;
  /** Every terminal that is not yet gone. */
  private readonly terminals = new Set<Terminal>();
  private stopping: Promise<void> | undefined;

  constructor(tmux: TmuxDriver, sessions: Sessions) {
    /** Per Session, the terminal the window was last sized for (see `writeSizedToTyper`). */
    const lastTyper = new Map<string, Terminal>();
    this.context = {
      tmux,
      sessions,
      lastTyper,
      forget: (terminal) => {
        this.terminals.delete(terminal);
        if (lastTyper.get(terminal.sessionId) === terminal) {
          lastTyper.delete(terminal.sessionId);
        }
      },
    };
  }

  /**
   * Opens a terminal on the Session for `viewer`, with the viewer's size (80 columns or 24
   * rows in place of a dimension that is not a whole number from 1 to 999). Returns at once; the Session is looked up and attached in the background.
   * If there is nothing to attach to, or the server is stopping, the viewer is ended.
   */
  attach(sessionId: string, size: Size, viewer: Viewer): Attachment {
    const terminal = new Terminal(this.context, sessionId, size, viewer);
    if (this.stopping) {
      terminal.end("server-stopping");
    } else {
      this.terminals.add(terminal);
      void terminal.open();
    }
    return terminal;
  }

  /**
   * Ends every terminal; their tmux clients detach and the Sessions keep running. From the
   * first call on, `attach` ends its viewer at once. Resolves once no tmux client this module
   * started is running or will start, so tmux can then be killed without a client racing it
   * (a tmux client that connects after that can start a fresh tmux server). Idempotent.
   */
  stop(): Promise<void> {
    // Assigned before any terminal is ended, so a viewer that reattaches from its `end` is
    // already refused.
    this.stopping ??= Promise.resolve().then(() => this.drain());
    return this.stopping;
  }

  private async drain(): Promise<void> {
    const draining = [...this.terminals];
    for (const terminal of draining) terminal.end("server-stopping");
    const gone = Promise.allSettled(draining.map((terminal) => terminal.gone));
    if (await settlesWithin(gone, CLIENT_EXIT_TIMEOUT_MS)) return;
    for (const terminal of draining) terminal.kill();
    await settlesWithin(gone, CLIENT_KILL_TIMEOUT_MS);
  }
}

/** What every terminal shares with the module that holds it. */
interface TerminalContext {
  tmux: TmuxDriver;
  sessions: Sessions;
  lastTyper: Map<string, Terminal>;
  /** Called once, when the terminal is gone. */
  forget(terminal: Terminal): void;
}

class Terminal implements Attachment {
  readonly sessionId: string;
  /** Settles when the terminal is gone. */
  readonly gone: Promise<void>;
  private readonly context: TerminalContext;
  private readonly viewer: Viewer;
  private phase: Phase = "looking-up";
  /** The viewer has been told the terminal ended, or has left: it is told nothing more. */
  private viewerDone = false;
  private size: Size;
  private client: TmuxClient | undefined;
  /** Input sent before the tmux client was attached, in order. */
  private pendingInput: string[] = [];
  /** Writes run one at a time, so waiting for tmux to resize never reorders input. */
  private writes: Promise<void> = Promise.resolve();
  private markGone!: () => void;

  constructor(context: TerminalContext, sessionId: string, size: Size, viewer: Viewer) {
    this.context = context;
    this.sessionId = sessionId;
    this.viewer = viewer;
    this.size = {
      cols: isDimension(size.cols) ? size.cols : DEFAULT_SIZE.cols,
      rows: isDimension(size.rows) ? size.rows : DEFAULT_SIZE.rows,
    };
    this.gone = new Promise((resolve) => {
      this.markGone = resolve;
    });
  }

  async open(): Promise<void> {
    let running: boolean;
    try {
      running = await this.context.sessions.hasRunningShell(this.sessionId);
    } catch (error) {
      if (this.phase !== "looking-up") return;
      console.error(`terminal for Session ${this.sessionId} failed to look it up`, error);
      return this.end("failed");
    }
    // The viewer left, or the module is stopping, while the Session was being looked up:
    // a tmux client started now would outlive them.
    if (this.phase !== "looking-up") return;
    if (!running) return this.end("session-ended");
    try {
      this.client = this.context.tmux.spawnClient(this.sessionId, this.size);
    } catch (error) {
      console.error(`terminal for Session ${this.sessionId} failed to attach`, error);
      return this.end("failed");
    }
    this.phase = "attached";
    this.client.onData((data) => {
      if (this.phase === "attached") this.viewer.show(data);
    });
    // The shell ended, or the Session was deleted (which kills its shell), or it detached.
    this.client.onExit(() => {
      if (this.phase === "attached") this.end("session-ended");
      this.becomeGone();
    });
    // Opening the terminal is viewing the Session. Cleared after attaching, so a bell that
    // rings from here on finds a client attached and is not recorded as unseen.
    void this.context.sessions.markSeen(this.sessionId).catch(() => undefined);
    for (const data of this.pendingInput.splice(0)) this.input(data);
  }

  input(data: string): void {
    if (data === "") return;
    if (this.phase === "looking-up") this.pendingInput.push(data);
    else if (this.phase === "attached") {
      // Nothing in a write throws; the catch keeps one that did from stopping all the rest.
      this.writes = this.writes.then(() => this.writeSizedToTyper(data)).catch(() => {});
    }
  }

  resize(cols: number, rows: number): void {
    if (!isDimension(cols) || !isDimension(rows)) return;
    this.size = { cols, rows };
    if (this.phase === "attached")
      this.ignoringExitedPty((client) => client.resize(cols, rows));
  }

  detach(): void {
    this.viewerDone = true;
    this.leave();
  }

  /** Lets go of the tmux client, and tells the viewer why the terminal ended (once). */
  end(reason: EndReason): void {
    // Let go first, so a viewer that throws cannot keep a tmux client running.
    this.leave();
    if (this.viewerDone) return;
    this.viewerDone = true;
    try {
      this.viewer.end(reason);
    } catch (error) {
      console.error(
        `terminal for Session ${this.sessionId} failed to end its viewer`,
        error,
      );
    }
  }

  /** Kills a tmux client that would not detach. */
  kill(): void {
    if (this.phase === "detaching") this.ignoringExitedPty((c) => c.kill("SIGKILL"));
  }

  private leave(): void {
    if (this.phase === "looking-up") this.becomeGone();
    else if (this.phase === "attached") {
      this.phase = "detaching";
      this.ignoringExitedPty((client) => client.kill());
    }
  }

  private becomeGone(): void {
    if (this.phase === "gone") return;
    this.phase = "gone";
    this.pendingInput = [];
    this.context.forget(this);
    this.markGone();
  }

  /** Writes to the tmux client only while it is attached; a gone pty must not be written. */
  private write(data: string): void {
    if (this.phase === "attached") this.ignoringExitedPty((client) => client.write(data));
  }

  /**
   * The pty can close a moment before its exit is reported, and then refuses writes, resizes
   * and signals. That is not an error: the exit, already on its way, ends the terminal.
   */
  private ignoringExitedPty(use: (client: TmuxClient) => void): void {
    if (!this.client) return;
    try {
      use(this.client);
    } catch {
      // The tmux client is exiting.
    }
  }

  /**
   * The window takes the size of whoever typed last. tmux (`window-size latest`) resizes the
   * window to the client that last sent a key, but only after it has read that key, and the
   * shell can read the same key first. So when a different terminal starts typing, its first
   * character goes in alone and the rest waits until the window has taken its size.
   */
  private async writeSizedToTyper(data: string): Promise<void> {
    const { lastTyper, tmux } = this.context;
    if (lastTyper.get(this.sessionId) === this || TERMINAL_REPORT.test(data)) {
      return this.write(data);
    }
    if (this.phase !== "attached") return;
    lastTyper.set(this.sessionId, this);
    const wanted = this.size;
    const same = (a: Size) => a.cols === wanted.cols && a.rows === wanted.rows;
    try {
      if (same(await tmux.windowSize(this.sessionId))) return this.write(data);
      // An escape sequence must not be cut, so it goes in whole.
      const head = data.startsWith("\x1b")
        ? data
        : String.fromCodePoint(data.codePointAt(0) ?? 0);
      this.write(head);
      for (let i = 0; i < 50 && this.phase === "attached"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (same(await tmux.windowSize(this.sessionId))) break;
      }
      if (data.length > head.length) this.write(data.slice(head.length));
    } catch {
      // The Session went away while we were waiting; the tmux client's exit reports that.
      this.write(data);
    }
  }
}

/** Whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
