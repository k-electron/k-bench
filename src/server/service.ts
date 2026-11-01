import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Store } from "./store.ts";
import type { TmuxDriver } from "./tmux.ts";

/** A failure the HTTP layer maps to a status code. */
export class ServiceError extends Error {
  readonly kind: "not_found" | "invalid";

  constructor(kind: "not_found" | "invalid", message: string) {
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
    const name = input.name?.trim() || basename(folder);
    const { id } = this.store.addWorkspace({ name, folder });
    return { id, name, folder };
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
