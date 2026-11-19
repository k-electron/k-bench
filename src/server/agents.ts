/**
 * Claude Agents on the server side: installing the Agent Runtime, starting one in its hidden
 * tmux session, reaching its socket, ending it and clearing its folder (ADR-0007, ADR-0008).
 * Everything the server does to an Agent goes through `AgentRuntimes`; the conversation
 * itself is the runtime's, and passes through the server unread (`AgentSockets`).
 * docs/internals/agent.md is the tour.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { readExitRecord } from "../agent/exit.ts";
import { LineSplitter } from "../agent/lines.ts";
import { AgentLogReader } from "../agent/log.ts";
import {
  agentFolder,
  agentLogFile,
  agentSocketFile,
  agentsRoot,
  ensureOwnerOnlyFolder,
  makeOwnerOnlyFolder,
  runtimeBuildId,
  runtimeFile,
  runtimesRoot,
} from "../agent/paths.ts";
import {
  type AgentHello,
  decodeAgentServerMessage,
  encodeAgentClientMessage,
} from "../shared/agent-protocol.ts";
import type { LaunchOptions } from "../shared/launch-options.ts";
import type { TmuxDriver } from "./tmux.ts";

/** How long a new runtime has to answer with its hello before it is given up on. */
const START_TIMEOUT_MS = 20_000;
/** How long `shutdown` waits for a runtime to exit by itself before its tmux session is killed. */
const SHUTDOWN_WAIT_MS = 4_000;
const RETRY_MS = 50;
/** What a runtime build's folder is named: its SHA-256, in hex (`runtimeBuildId`). */
const BUILD_ID = /^[0-9a-f]{64}$/;

/** An Agent Runtime could not be started or did not come up. The message says why. */
export class AgentStartError extends Error {}

/** A runtime installed in the data directory. */
export interface InstalledRuntime {
  buildId: string;
  file: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The server's handle on Claude Agents. It keeps no state about a running Agent: whether one
 * runs is tmux's to say (ADR-0002), and what it is doing is the runtime's.
 */
export class AgentRuntimes {
  private readonly dataDir: string;
  private readonly tmux: TmuxDriver;
  private readonly sourceFile: string | undefined;
  private installed: InstalledRuntime | undefined;
  private problem: string | undefined;

  /**
   * `runtimeFile` is the built runtime (`pnpm build:runtime`, or the one in the package) that
   * `install` copies into the data directory. Without one no Claude Agent can start.
   */
  constructor(options: { dataDir: string; tmux: TmuxDriver; runtimeFile?: string }) {
    this.dataDir = options.dataDir;
    this.tmux = options.tmux;
    this.sourceFile = options.runtimeFile;
  }

  /**
   * Copies the runtime into its own versioned folder, `<dataDir>/runtimes/<build id>/`, so it
   * can run on after the app folder it came from is replaced by an update (ADR-0007). A build
   * already there is left alone. Never throws: a missing runtime only means Claude Agents are
   * not available, which `launch` then says.
   */
  install(): InstalledRuntime | undefined {
    try {
      if (!this.sourceFile || !existsSync(this.sourceFile)) {
        throw new Error("The Agent Runtime has not been built. Run `pnpm build`.");
      }
      const bytes = readFileSync(this.sourceFile);
      const buildId = runtimeBuildId(bytes);
      const file = runtimeFile(this.dataDir, buildId);
      if (!existsSync(file)) {
        ensureOwnerOnlyFolder(runtimesRoot(this.dataDir));
        ensureOwnerOnlyFolder(dirname(file));
        // Through a temporary name, so a runtime is never started from half a file.
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, bytes);
        renameSync(temporary, file);
      }
      this.installed = { buildId, file };
      this.problem = undefined;
    } catch (error) {
      this.installed = undefined;
      this.problem = error instanceof Error ? error.message : String(error);
      console.warn(`Claude Agents are unavailable: ${this.problem}`);
    }
    return this.installed;
  }

  /**
   * Deletes the installed runtime builds that are neither the current one nor in `inUse`, the
   * builds running Agents were started from (ADR-0007: a folder is kept until no running
   * runtime uses it). A runtime has read its file when it started, so a folder could be removed
   * earlier; keeping it until its last Agent is gone is the rule, and it is what lets a
   * running Agent be inspected, or a failed Restart tried again, on the build it runs.
   * Anything under the runtimes folder that is not a build's folder is left alone.
   */
  pruneRuntimes(inUse: ReadonlySet<string>): void {
    let names: string[];
    try {
      names = readdirSync(runtimesRoot(this.dataDir));
    } catch {
      return;
    }
    for (const name of names) {
      if (!BUILD_ID.test(name) || name === this.installed?.buildId || inUse.has(name)) {
        continue;
      }
      rmSync(join(runtimesRoot(this.dataDir), name), { recursive: true, force: true });
    }
  }

  /** The runtime a new Agent would start, or undefined when none could be installed. */
  get current(): InstalledRuntime | undefined {
    return this.installed;
  }

  /** The Agent's folder. */
  folder(sessionId: string): string {
    return agentFolder(this.dataDir, sessionId);
  }

  /**
   * Starts the Agent Runtime in its hidden tmux session, and returns without waiting for it
   * (`waitUntilReady` does). Makes the Agent's folder, owner-only, if it is not there: a
   * restart finds its log in it.
   */
  async launch(input: {
    sessionId: string;
    /** The Workspace's folder, where Claude Code runs. */
    workspaceFolder: string;
    conversationId: string;
    mode: "start" | "resume";
    /** The Session's Launch options, passed to the runtime at every start. */
    options: LaunchOptions;
  }): Promise<void> {
    const runtime = this.installed ?? this.install();
    if (!runtime) {
      throw new AgentStartError(this.problem ?? "The Agent Runtime is not installed");
    }
    ensureOwnerOnlyFolder(agentsRoot(this.dataDir));
    const folder = this.folder(input.sessionId);
    try {
      makeOwnerOnlyFolder(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      ensureOwnerOnlyFolder(folder);
    }
    await this.tmux.createAgentSession(input.sessionId, input.workspaceFolder, {
      node: process.execPath,
      runtimeFile: runtime.file,
      agentFolder: folder,
      conversationId: input.conversationId,
      mode: input.mode,
      options: input.options,
    });
  }

  /**
   * Connects to the Agent's socket, trying again until the runtime listens. Gives up, with
   * `undefined`, when `stillWanted` says the Agent is gone (its Session ended), and throws
   * `AgentStartError` when nothing listens within `timeoutMs`.
   */
  async connect(
    sessionId: string,
    stillWanted: () => Promise<boolean>,
    timeoutMs = START_TIMEOUT_MS,
  ): Promise<Socket | undefined> {
    const file = agentSocketFile(this.folder(sessionId));
    const deadline = Date.now() + timeoutMs;
    for (let attempt = 1; ; attempt++) {
      const socket = await tryConnect(file);
      if (socket) return socket;
      if (Date.now() >= deadline) {
        throw new AgentStartError("The Agent Runtime did not answer in time");
      }
      if (attempt % 5 === 0 && !(await stillWanted())) return undefined;
      await sleep(RETRY_MS);
    }
  }

  /**
   * Waits until the Agent's runtime has started and says hello, and returns that hello. If
   * the runtime ends first, or never answers, throws `AgentStartError` with the reason it
   * recorded, in plain words.
   */
  async waitUntilReady(sessionId: string): Promise<AgentHello> {
    const running = () => this.isRunning(sessionId);
    let socket: Socket | undefined;
    try {
      socket = await this.connect(sessionId, running);
    } catch (error) {
      throw new AgentStartError(this.whyEnded(sessionId, error));
    }
    if (!socket) throw new AgentStartError(this.whyEnded(sessionId));
    const connected = socket;
    try {
      return await new Promise<AgentHello>((resolve, reject) => {
        const lines = new LineSplitter();
        connected.setEncoding("utf8");
        connected.on("data", (chunk: string) => {
          for (const line of lines.push(chunk)) {
            const message = decodeAgentServerMessage(line);
            if (message?.type === "hello") resolve(message);
          }
        });
        connected.on("close", () => reject(new Error("The Agent Runtime hung up")));
        connected.on("error", reject);
      });
    } catch (error) {
      throw new AgentStartError(this.whyEnded(sessionId, error));
    } finally {
      connected.destroy();
    }
  }

  /** Whether the Agent's tmux session is alive: the one record of running (ADR-0002). */
  async isRunning(sessionId: string): Promise<boolean> {
    return (await this.tmux.listSessions()).some((live) => live.id === sessionId);
  }

  /** In plain words, why an Agent Runtime that should be answering is not. */
  private whyEnded(sessionId: string, error?: unknown): string {
    const record = readExitRecord(this.folder(sessionId));
    if (record?.reason) return record.reason;
    if (record) return "The Agent Runtime exited unexpectedly";
    return error instanceof Error ? error.message : "The Agent Runtime did not start";
  }

  /**
   * Why a Stopped Agent stopped, in plain words, for the Pane. The runtime records a reason
   * on every exit it controls (the owner stopped it, Claude Code died, a crash); one that
   * left none was killed (the launcher still records that it ended), or never got to say
   * (the Mac went down with it).
   */
  stoppedReason(sessionId: string): string {
    const record = readExitRecord(this.folder(sessionId));
    if (record?.reason) return record.reason;
    if (record) return "The Agent Runtime exited unexpectedly";
    return "The Agent Runtime is gone (the Mac may have restarted)";
  }

  /** The Agent's log, for reading only: what a Stopped Agent shows (`AgentSockets`). */
  readLog(sessionId: string): AgentLogReader {
    return new AgentLogReader(agentLogFile(this.folder(sessionId)));
  }

  /**
   * Deletes every Agent folder that `known` does not name a Session for: left behind by a
   * Session that was deleted while the server was down, or by one whose creation never
   * finished. For the server's start, before it takes requests: a folder is made before its
   * Session's row, so run later it could take one being made.
   */
  removeStrayFolders(known: (sessionId: string) => boolean): void {
    const root = agentsRoot(this.dataDir);
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      return;
    }
    for (const name of names) {
      if (!known(name)) this.removeFolder(name);
    }
  }

  /**
   * Ends the Agent: asks its runtime to shut down, which interrupts the turn, finishes the
   * log and closes Claude Code, then gives it a few seconds to exit before killing its tmux
   * session. Fine for an Agent that is not running.
   */
  async shutdown(sessionId: string): Promise<void> {
    const socket = await tryConnect(agentSocketFile(this.folder(sessionId)));
    if (socket) {
      socket.on("error", () => undefined);
      socket.write(`${encodeAgentClientMessage({ type: "shutdown" })}\n`);
    }
    const deadline = Date.now() + SHUTDOWN_WAIT_MS;
    while ((await this.isRunning(sessionId)) && Date.now() < deadline) {
      await sleep(RETRY_MS);
    }
    socket?.destroy();
    await this.tmux.killSession(sessionId);
  }

  /** Deletes the Agent's folder: its log, socket and everything else. Call after `shutdown`. */
  removeFolder(sessionId: string): void {
    rmSync(this.folder(sessionId), { recursive: true, force: true });
  }
}

/** One attempt at connecting to a unix socket: the socket, or undefined if nothing listens. */
function tryConnect(file: string): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const socket = connect(file);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}
