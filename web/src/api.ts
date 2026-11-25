/** Typed client for the server's JSON API. The state it reports is in `src/shared/state-protocol.ts`. */

import type { LaunchOptions } from "../../src/shared/launch-options.ts";
import { type RightPaneState, revisionOf } from "../../src/shared/state-protocol.ts";

export interface DirectoryListing {
  path: string;
  parent?: string;
  directories: Array<{ name: string; path: string }>;
  /** The picker root (Home), which the folder picker shows among its Places. */
  root: string;
}

export class ApiError extends Error {
  /** The HTTP status the server answered with. */
  readonly status: number;
  /** The refusal's whole JSON body, which can carry more than its `error` message. */
  readonly body: Record<string, unknown>;

  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /**
   * The Workspace that already has the folder, when that is why a create or folder change
   * was refused.
   */
  get folderOwner(): { id: string; name: string } | undefined {
    const owner = this.body.workspace as { id?: unknown; name?: unknown } | undefined;
    return this.status === 409 &&
      typeof owner?.id === "string" &&
      typeof owner.name === "string"
      ? { id: owner.id, name: owner.name }
      : undefined;
  }
}

/**
 * What a change request answered: its body, and the state revision from which the events
 * WebSocket's snapshots show the change. Every successful change answers with one; were it
 * missing, the revision is NaN, which no snapshot reaches, so a wait for it times out.
 */
export interface Change<T> {
  value: T;
  revision: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<Change<T>> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw new ApiError(
      typeof body.error === "string" ? body.error : `Request failed (${response.status})`,
      response.status,
      body,
    );
  return { value: body as T, revision: revisionOf(response.headers) };
}

async function get<T>(path: string): Promise<T> {
  return (await call<T>(path)).value;
}

function send<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Change<T>> {
  return call<T>(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * The server's API. Reads return their value; changes return a `Change`, so the caller can
 * wait for the change to show in state (see `StateClient`), which is the one way the
 * Workspaces and Sessions reach the page.
 */
export const api = {
  /**
   * Subfolders of `path`, or of the picker's starting folder when omitted; hidden ones (a
   * leading `.`) only with `hidden`.
   */
  listDirectories: (path?: string, { hidden = false }: { hidden?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (path !== undefined) query.set("path", path);
    if (hidden) query.set("hidden", "1");
    return get<DirectoryListing>(`/api/directories?${query}`);
  },
  createWorkspace: (input: {
    folder: string;
    name?: string;
    createMissingFolders?: boolean;
  }) =>
    send<{ id: string; name: string; folder: string }>("POST", "/api/workspaces", input),
  updateWorkspace: (
    id: string,
    changes: { name?: string; folder?: string; createMissingFolders?: boolean },
  ) => send<void>("PATCH", `/api/workspaces/${id}`, changes),
  /** `ids` is every Workspace, in the order wanted. */
  reorderWorkspaces: (ids: string[]) =>
    send<void>("PUT", "/api/workspaces/order", { ids }),
  /**
   * Makes it the Open Workspace and starts its Stopped Prime and Worker. With `showWorker`,
   * its right Pane shows the Worker again.
   */
  openWorkspace: (id: string, options: { showWorker?: boolean } = {}) =>
    send<{ id: string }>("POST", `/api/workspaces/${id}/open`, options),
  /** Sets the Workspace's right Pane: its tabs, and the one shown (null for the Worker). */
  setRightPane: (id: string, rightPane: RightPaneState) =>
    send<RightPaneState>("PUT", `/api/workspaces/${id}/right-pane`, rightPane),
  deleteWorkspace: (id: string) => send<void>("DELETE", `/api/workspaces/${id}`),
  /** The Launch options last used for a Claude Session; all Default if none has been. */
  lastLaunchOptions: () => get<LaunchOptions>("/api/claude/launch-options"),
  /** An ordinary shell Session, or with `claude` a Claude Session. */
  createSession: (
    workspaceId: string,
    input: { name?: string; claude?: LaunchOptions } = {},
  ) =>
    send<{ id: string; name: string }>(
      "POST",
      `/api/workspaces/${workspaceId}/sessions`,
      input,
    ),
  renameSession: (sessionId: string, name: string) =>
    send<{ id: string; name: string }>("PATCH", `/api/sessions/${sessionId}`, { name }),
  deleteSession: (sessionId: string) =>
    send<void>("DELETE", `/api/sessions/${sessionId}`),
  restartSession: (sessionId: string) =>
    send<{ id: string; name: string }>("POST", `/api/sessions/${sessionId}/restart`, {}),
};
