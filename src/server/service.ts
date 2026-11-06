import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DEFAULT_LAUNCH_OPTIONS, type LaunchOptions } from "../shared/launch-options.ts";
import type { State } from "../shared/state-protocol.ts";
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

/** The domain operations. The store holds what the owner chose; tmux says what is alive. */
export class Service {
  private readonly store: Store;
  private readonly tmux: TmuxDriver;
  private sessionCreations: Promise<unknown> = Promise.resolve();
  private readonly reconciler: Reconciler;
  private readonly restarts = new Map<string, Promise<void>>();

  constructor(store: Store, tmux: TmuxDriver) {
    this.store = store;
    this.tmux = tmux;
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
    const ids = this.store.listSessions(id).map((session) => session.id);
    // Every shell gets its kill, even if one fails; a failure keeps the Workspace so the
    // owner can retry (killing is idempotent), instead of leaving a half-killed one.
    const kills = await Promise.allSettled(
      ids.map((sessionId) => this.tmux.killSession(sessionId)),
    );
    const failed = kills.find((kill) => kill.status === "rejected");
    if (failed) throw failed.reason;
    this.store.deleteWorkspace(id);
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
    /** Makes it a Claude Session started with these Launch options. */
    launchOptions?: LaunchOptions,
  ) {
    const result = this.sessionCreations.then(() =>
      this.createSessionNow(workspaceId, requestedName, launchOptions),
    );
    this.sessionCreations = result.catch(() => undefined);
    return result;
  }

  private async createSessionNow(
    workspaceId: string,
    requestedName: string | undefined,
    launchOptions: LaunchOptions | undefined,
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
    const conversationId = launchOptions ? randomUUID() : undefined;
    await this.reconciler.whileStarting(id, async () => {
      await this.tmux.createSession(
        id,
        workspace.folder,
        launchOptions && conversationId !== undefined
          ? { conversationId, options: launchOptions }
          : undefined,
      );
      try {
        this.store.addSession({ id, workspaceId, name, conversationId, launchOptions });
      } catch (error) {
        await this.tmux.killSession(id);
        throw error;
      }
    });
    return { id, name };
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
    if (!this.store.getSession(sessionId)) {
      throw new ServiceError("not_found", "Unknown Session");
    }
    await this.tmux.killSession(sessionId);
    this.store.deleteSession(sessionId);
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
  }): Promise<void> {
    if ((await this.tmux.listSessions()).some((live) => live.id === session.id)) return;
    if (!isDirectory(session.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${session.folder}`);
    }
    await this.reconciler.whileStarting(session.id, () =>
      this.tmux.createSession(
        session.id,
        session.folder,
        session.conversationId === null
          ? undefined
          : {
              conversationId: session.conversationId,
              // Every Option is passed again each time (ADR-0005).
              options: session.launchOptions ?? DEFAULT_LAUNCH_OPTIONS,
            },
      ),
    );
  }

  /** Whether the terminal WebSocket has a shell to attach to: a known Session that is running. */
  async hasRunningShell(sessionId: string): Promise<boolean> {
    if (!this.store.getSession(sessionId)) return false;
    const live = await this.tmux.listSessions();
    return live.some((s) => s.id === sessionId);
  }
}
