import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
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

export interface SessionState {
  id: string;
  name: string;
  status: "running" | "stopped";
}
export interface WorkspaceState {
  id: string;
  name: string;
  folder: string;
  position: number;
  sessions: SessionState[];
}
export interface State {
  workspaces: WorkspaceState[];
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

  async createSession(workspaceId: string, requestedName?: string) {
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
    }
    const id = randomUUID();
    await this.reconciler.whileStarting(id, async () => {
      await this.tmux.createSession(id, workspace.folder);
      try {
        this.store.addSession({ id, workspaceId, name });
      } catch (error) {
        await this.tmux.killSession(id);
        throw error;
      }
    });
    return { id, name };
  }

  async getState(): Promise<State> {
    const live = await this.reconciler.reconcile();
    return {
      workspaces: this.store.listWorkspaces().map((workspace) => ({
        ...workspace,
        sessions: this.store.listSessions(workspace.id).map((session) => ({
          id: session.id,
          name: session.name,
          status: live.has(session.id) ? "running" : "stopped",
        })),
      })),
    };
  }

  /**
   * Gives a Stopped Session a fresh shell in its Workspace folder, keeping its id and name.
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

  private async startStopped(session: { id: string; folder: string }): Promise<void> {
    if ((await this.tmux.listSessions()).includes(session.id)) return;
    if (!isDirectory(session.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${session.folder}`);
    }
    await this.reconciler.whileStarting(session.id, () =>
      this.tmux.createSession(session.id, session.folder),
    );
  }

  /** What the terminal WebSocket needs to know before attaching. */
  async terminalTarget(sessionId: string): Promise<"unknown" | "stopped" | "running"> {
    if (!this.store.getSession(sessionId)) return "unknown";
    const live = await this.tmux.listSessions();
    return live.includes(sessionId) ? "running" : "stopped";
  }
}
