/** Typed client for the server's JSON API. Shapes mirror `src/server/service.ts`. */

export interface SessionState {
  id: string;
  name: string;
  status: "running" | "stopped";
  /** The shell rang the terminal bell and nobody has seen it since. */
  bell: boolean;
}
export interface WorkspaceState {
  id: string;
  name: string;
  folder: string;
  position: number;
  /** The folder no longer exists on the Host. */
  missing: boolean;
  sessions: SessionState[];
}
export interface AppState {
  workspaces: WorkspaceState[];
}

export interface DirectoryListing {
  path: string;
  parent?: string;
  directories: Array<{ name: string; path: string }>;
}

export class ApiError extends Error {}

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
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new ApiError(body.error ?? `Request failed (${response.status})`);
  const revision = Number(response.headers.get("State-Revision") ?? Number.NaN);
  return { value: body as T, revision };
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
 * wait for the change to show in state (see `useAppState`), which is the one way the
 * Workspaces and Sessions reach the page.
 */
export const api = {
  /** Subfolders of `path`, or of the configured root when omitted. */
  listDirectories: (path?: string) =>
    get<DirectoryListing>(
      path === undefined
        ? "/api/directories"
        : `/api/directories?path=${encodeURIComponent(path)}`,
    ),
  createWorkspace: (input: { folder: string; name?: string }) =>
    send<{ id: string; name: string; folder: string }>("POST", "/api/workspaces", input),
  updateWorkspace: (id: string, changes: { name?: string; folder?: string }) =>
    send<void>("PATCH", `/api/workspaces/${id}`, changes),
  /** `ids` is every Workspace, in the order wanted. */
  reorderWorkspaces: (ids: string[]) =>
    send<void>("PUT", "/api/workspaces/order", { ids }),
  deleteWorkspace: (id: string) => send<void>("DELETE", `/api/workspaces/${id}`),
  createSession: (workspaceId: string, name?: string) =>
    send<{ id: string; name: string }>(
      "POST",
      `/api/workspaces/${workspaceId}/sessions`,
      { name },
    ),
  renameSession: (sessionId: string, name: string) =>
    send<{ id: string; name: string }>("PATCH", `/api/sessions/${sessionId}`, { name }),
  deleteSession: (sessionId: string) =>
    send<void>("DELETE", `/api/sessions/${sessionId}`),
  restartSession: (sessionId: string) =>
    send<{ id: string; name: string }>("POST", `/api/sessions/${sessionId}/restart`, {}),
};
