/** Typed client for the server's JSON API. Shapes mirror `src/server/service.ts`. */

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
export interface AppState {
  workspaces: WorkspaceState[];
}

export interface DirectoryListing {
  path: string;
  parent?: string;
  directories: Array<{ name: string; path: string }>;
}

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new ApiError(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function send<T>(
  method: "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return call<T>(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  getState: () => call<AppState>("/api/state"),
  /** Subfolders of `path`, or of the configured root when omitted. */
  listDirectories: (path?: string) =>
    call<DirectoryListing>(
      path === undefined
        ? "/api/directories"
        : `/api/directories?path=${encodeURIComponent(path)}`,
    ),
  createWorkspace: (input: { folder: string; name?: string }) =>
    post<{ id: string; name: string; folder: string }>("/api/workspaces", input),
  updateWorkspace: (id: string, changes: { name?: string; folder?: string }) =>
    send<void>("PATCH", `/api/workspaces/${id}`, changes),
  /** `ids` is every Workspace, in the order wanted. */
  reorderWorkspaces: (ids: string[]) =>
    send<void>("PUT", "/api/workspaces/order", { ids }),
  deleteWorkspace: (id: string) => send<void>("DELETE", `/api/workspaces/${id}`),
  createSession: (workspaceId: string, name?: string) =>
    post<{ id: string; name: string }>(`/api/workspaces/${workspaceId}/sessions`, {
      name,
    }),
  renameSession: (sessionId: string, name: string) =>
    send<{ id: string; name: string }>("PATCH", `/api/sessions/${sessionId}`, { name }),
  deleteSession: (sessionId: string) =>
    send<void>("DELETE", `/api/sessions/${sessionId}`),
  restartSession: (sessionId: string) =>
    post<{ id: string; name: string }>(`/api/sessions/${sessionId}/restart`, {}),
};
