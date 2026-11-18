import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DEFAULT_LAUNCH_OPTIONS, type LaunchOptions } from "../shared/launch-options.ts";
import type { ClaudeInterface, NewSessionKind, State } from "../shared/state-protocol.ts";
import { type AgentRuntimes, AgentStartError } from "./agents.ts";
import type { ClaudeLaunch } from "./claude.ts";
import { availableName } from "./naming.ts";
import { Reconciler } from "./reconciler.ts";
import type { Store } from "./store.ts";
import type { TmuxDriver } from "./tmux.ts";

/** A failure the HTTP layer maps to a status code. */
export class ServiceError extends Error {
  readonly kind: "not_found" | "conflict" | "invalid";

  constructor(kind: "not_found" | "conflict" | "invalid", message: string) {
    super(message);
    this.kind = kind;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What makes a new Session a Claude Session: its Launch options and its interface. */
export interface ClaudeSessionRequest {
  options: LaunchOptions;
  interface: ClaudeInterface;
}

/** The domain operations. The store holds what the owner chose; tmux says what is alive. */
export class Service {
  private readonly store: Store;
  private readonly tmux: TmuxDriver;
  private readonly agents: AgentRuntimes;
  private sessionCreations: Promise<unknown> = Promise.resolve();
  private readonly reconciler: Reconciler;
  private readonly restarts = new Map<string, Promise<void>>();

  constructor(store: Store, tmux: TmuxDriver, agents: AgentRuntimes) {
    this.store = store;
    this.tmux = tmux;
    this.agents = agents;
    this.reconciler = new Reconciler(store, tmux);
  }

  /** Kills tmux sessions that have no store record. Runs at startup and on every state read. */
  async reconcile(): Promise<void> {
    await this.reconciler.reconcile();
  }

  createWorkspace(input: { name?: string; folder: string }) {
    const folder = resolve(input.folder);
    if (!isDirectory(folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${folder}`);
    }
    const explicit = input.name?.trim();
    if (explicit) this.assertWorkspaceNameFree(explicit);
    const name = explicit || availableName(basename(folder), this.workspaceNames());
    const { id } = this.store.addWorkspace({ name, folder });
    return { id, name, folder };
  }

  /** Renames and/or re-folders a Workspace; both changes are checked before either is made. */
  updateWorkspace(id: string, changes: { name?: string; folder?: string }) {
    const workspace = this.store.getWorkspace(id);
    if (!workspace) throw new ServiceError("not_found", "Unknown Workspace");
    const update: { name?: string; folder?: string } = {};
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (!name) throw new ServiceError("invalid", "name must not be blank");
      this.assertWorkspaceNameFree(name, id);
      update.name = name;
    }
    if (changes.folder !== undefined) {
      const folder = resolve(changes.folder);
      if (!isDirectory(folder)) {
        throw new ServiceError("invalid", `Folder does not exist: ${folder}`);
      }
      update.folder = folder;
    }
    this.store.updateWorkspace(id, update);
    return { ...workspace, ...update };
  }

  /** `ids` must be every Workspace exactly once, in the order the owner wants. */
  reorderWorkspaces(ids: string[]): void {
    const known = this.store.listWorkspaces().map((w) => w.id);
    if (ids.length !== known.length || !known.every((id) => ids.includes(id))) {
      throw new ServiceError("invalid", "ids must list every Workspace exactly once");
    }
    this.store.setWorkspaceOrder(ids);
  }

  /** Ends the Workspace's shells first, then forgets it. The folder on disk is never touched. */
  async deleteWorkspace(id: string): Promise<void> {
    if (!this.store.getWorkspace(id))
      throw new ServiceError("not_found", "Unknown Workspace");
    const sessions = this.store.listSessions(id);
    // Every Session gets its end, even if one fails; a failure keeps the Workspace so the
    // owner can retry (ending is idempotent), instead of leaving a half-ended one.
    const ends = await Promise.allSettled(
      sessions.map((session) => this.endSession(session)),
    );
    const failed = ends.find((end) => end.status === "rejected");
    if (failed) throw failed.reason;
    this.store.deleteWorkspace(id);
    for (const session of sessions) {
      if (session.interface === "agent") this.agents.removeFolder(session.id);
    }
  }

  /**
   * Ends a Session's program and everything in it. A Claude Agent's runtime is asked to shut
   * down first, so its log is finished and its Claude Code closed before its tmux session goes.
   */
  private async endSession(session: {
    id: string;
    interface: ClaudeInterface | null;
  }): Promise<void> {
    if (session.interface === "agent") await this.agents.shutdown(session.id);
    else await this.tmux.killSession(session.id);
  }

  private workspaceNames(exceptId?: string): Set<string> {
    return new Set(
      this.store
        .listWorkspaces()
        .filter((w) => w.id !== exceptId)
        .map((w) => w.name),
    );
  }

  /** Workspace names are unique. Renaming reuses this, passing the Workspace being renamed. */
  private assertWorkspaceNameFree(name: string, exceptId?: string): void {
    if (this.workspaceNames(exceptId).has(name)) {
      throw new ServiceError("conflict", `A Workspace named "${name}" already exists`);
    }
  }

  /**
   * One at a time: choosing the name and storing the Session are separated by starting
   * the shell, so overlapping creations would otherwise pick the same default name.
   */
  createSession(
    workspaceId: string,
    requestedName?: string,
    /** Makes it a Claude Session, started with these Launch options in this interface. */
    claude?: ClaudeSessionRequest,
  ) {
    const result = this.sessionCreations.then(() =>
      this.createSessionNow(workspaceId, requestedName, claude),
    );
    this.sessionCreations = result.catch(() => undefined);
    return result;
  }

  private async createSessionNow(
    workspaceId: string,
    requestedName: string | undefined,
    request: ClaudeSessionRequest | undefined,
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) throw new ServiceError("not_found", "Unknown Workspace");
    if (!isDirectory(workspace.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${workspace.folder}`);
    }
    const taken = new Set(this.store.listSessions(workspaceId).map((s) => s.name));
    let name = requestedName?.trim();
    if (!name) {
      let n = 1;
      while (taken.has(`session ${n}`)) n++;
      name = `session ${n}`;
    } else if (taken.has(name)) {
      throw new ServiceError("conflict", `A Session named "${name}" already exists`);
    }
    const id = randomUUID();
    // k-bench chooses the Claude conversation's ID, so a restart can name it (ADR-0005).
    const claude: ClaudeLaunch | undefined = request && {
      conversationId: randomUUID(),
      options: request.options,
      mode: "start",
    };
    const agent = request?.interface === "agent";
    await this.reconciler.whileStarting(id, async () => {
      try {
        if (claude && agent) {
          await this.agents.launch({
            sessionId: id,
            workspaceFolder: workspace.folder,
            conversationId: claude.conversationId,
            mode: "start",
          });
        } else {
          await this.tmux.createSession(id, workspace.folder, claude);
        }
      } catch (error) {
        if (agent) this.agents.removeFolder(id);
        throw error instanceof AgentStartError
          ? new ServiceError("invalid", `Claude Agent could not start: ${error.message}`)
          : error;
      }
      try {
        this.store.addSession({
          id,
          workspaceId,
          name,
          conversationId: claude?.conversationId,
          launchOptions: claude?.options,
          interface: request?.interface,
        });
      } catch (error) {
        await this.endSession({ id, interface: request?.interface ?? null });
        if (agent) this.agents.removeFolder(id);
        throw error;
      }
    });
    if (agent) await this.finishStartingAgent(id, "create");
    // Remembered for the next New Session dialog, on any device. A shell leaves the Launch
    // options as they were, so switching the dialog back to Claude finds them; so does a
    // Claude Agent, which takes none yet.
    this.store.setLastSessionKind(
      !request ? "shell" : request.interface === "agent" ? "claude-agent" : "claude",
    );
    if (request && !agent) this.store.setLastLaunchOptions(request.options);
    return { id, name };
  }

  /**
   * Waits for a Claude Agent's runtime to come up. If it does not, the Agent is undone as
   * far as `step` got (a new Session is deleted; a restarted one stays Stopped) and the
   * reason the runtime recorded is the refusal.
   */
  private async finishStartingAgent(id: string, step: "create" | "restart") {
    try {
      await this.agents.waitUntilReady(id);
    } catch (error) {
      await this.agents.shutdown(id);
      if (step === "create") {
        this.store.deleteSession(id);
        this.agents.removeFolder(id);
      }
      const why = error instanceof Error ? error.message : String(error);
      throw new ServiceError("invalid", `Claude Agent could not start: ${why}`);
    }
  }

  /**
   * What the New Session dialog opens on: the kind of Session created last, and the Launch
   * options last used for a Claude Session. A shell, and all Default with Focus view off, if
   * none has been created.
   */
  lastNewSession(): { kind: NewSessionKind; claude: LaunchOptions } {
    return {
      kind: this.store.getLastSessionKind() ?? "shell",
      claude: this.store.getLastLaunchOptions() ?? DEFAULT_LAUNCH_OPTIONS,
    };
  }

  renameSession(sessionId: string, requestedName: string): { id: string; name: string } {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    const name = requestedName.trim();
    if (!name) throw new ServiceError("invalid", "name is required");
    const clash = this.store
      .listSessions(session.workspaceId)
      .some((other) => other.id !== sessionId && other.name === name);
    if (clash) {
      throw new ServiceError("conflict", `A Session named "${name}" already exists`);
    }
    this.store.renameSession(sessionId, name);
    return { id: sessionId, name };
  }

  /** Ends the Session's shell and everything in it, then forgets the Session. */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    await this.endSession(session);
    this.store.deleteSession(sessionId);
    // Last: the runtime has gone and the row with it, so nothing can write here again.
    if (session.interface === "agent") this.agents.removeFolder(sessionId);
  }

  async getState(): Promise<State> {
    const live = await this.reconciler.reconcile();
    return {
      workspaces: this.store.listWorkspaces().map((workspace) => ({
        ...workspace,
        missing: !isDirectory(workspace.folder),
        sessions: this.store.listSessions(workspace.id).map((session) => ({
          id: session.id,
          name: session.name,
          kind: session.kind,
          ...(session.interface ? { interface: session.interface } : {}),
          status: live.has(session.id) ? "running" : "stopped",
          bell: live.get(session.id)?.bell ?? false,
        })),
      })),
    };
  }

  /**
   * Gives a Stopped Session a fresh program in its Workspace folder, keeping its id and name:
   * a shell, or Claude Code for a Claude Session.
   * A Session that is already running is left alone.
   */
  async restartSession(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    // Two restarts of the same Session (a double click) share one start.
    let restart = this.restarts.get(sessionId);
    if (!restart) {
      restart = this.startStopped(session).finally(() => this.restarts.delete(sessionId));
      this.restarts.set(sessionId, restart);
    }
    await restart;
    return { id: session.id, name: session.name };
  }

  private async startStopped(session: {
    id: string;
    folder: string;
    conversationId: string | null;
    launchOptions: LaunchOptions | null;
    interface: ClaudeInterface | null;
  }): Promise<void> {
    if ((await this.tmux.listSessions()).some((live) => live.id === session.id)) return;
    if (!isDirectory(session.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${session.folder}`);
    }
    if (session.interface === "agent" && session.conversationId !== null) {
      const { id, folder, conversationId } = session;
      await this.reconciler.whileStarting(id, async () => {
        try {
          await this.agents.launch({
            sessionId: id,
            workspaceFolder: folder,
            conversationId,
            mode: "resume",
          });
        } catch (error) {
          throw error instanceof AgentStartError
            ? new ServiceError(
                "invalid",
                `Claude Agent could not start: ${error.message}`,
              )
            : error;
        }
      });
      await this.finishStartingAgent(id, "restart");
      return;
    }
    await this.reconciler.whileStarting(session.id, () =>
      this.tmux.createSession(
        session.id,
        session.folder,
        session.conversationId === null
          ? undefined
          : {
              conversationId: session.conversationId,
              mode: "resume",
              // Every Launch option is passed again each time (ADR-0005).
              options: session.launchOptions ?? DEFAULT_LAUNCH_OPTIONS,
            },
      ),
    );
  }

  /**
   * Whether the terminal WebSocket has a shell to attach to: a known Session that is running.
   * Never a Claude Agent, whose tmux session is hidden: no terminal attaches to it (ADR-0007).
   */
  async hasRunningShell(sessionId: string): Promise<boolean> {
    const session = this.store.getSession(sessionId);
    if (!session || session.interface === "agent") return false;
    const live = await this.tmux.listSessions();
    return live.some((s) => s.id === sessionId);
  }

  /** Whether the agent WebSocket has a runtime to relay to: a known Claude Agent that is running. */
  async hasRunningAgent(sessionId: string): Promise<boolean> {
    if (this.store.getSession(sessionId)?.interface !== "agent") return false;
    return this.agents.isRunning(sessionId);
  }
}
