import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { availableName } from "./naming.ts";
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

  constructor(store: Store, tmux: TmuxDriver) {
    this.store = store;
    this.tmux = tmux;
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
    for (const session of this.store.listSessions(id)) {
      await this.tmux.killSession(session.id);
    }
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
    await this.tmux.createSession(id, workspace.folder);
    try {
      this.store.addSession({ id, workspaceId, name });
    } catch (error) {
      await this.tmux.killSession(id);
      throw error;
    }
    return { id, name };
  }

  async getState(): Promise<State> {
    const live = new Set(await this.tmux.listSessions());
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

  /** What the terminal WebSocket needs to know before attaching. */
  async terminalTarget(sessionId: string): Promise<"unknown" | "stopped" | "running"> {
    if (!this.store.getSession(sessionId)) return "unknown";
    const live = await this.tmux.listSessions();
    return live.includes(sessionId) ? "running" : "stopped";
  }
}
