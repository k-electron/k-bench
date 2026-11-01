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

export const api = {
  getState: () => call<AppState>("/api/state"),
  createWorkspace: (input: { folder: string; name?: string }) =>
    post<{ id: string; name: string; folder: string }>("/api/workspaces", input),
  createSession: (workspaceId: string, name?: string) =>
    post<{ id: string; name: string }>(`/api/workspaces/${workspaceId}/sessions`, {
      name,
    }),
  restartSession: (sessionId: string) =>
    post<{ id: string; name: string }>(`/api/sessions/${sessionId}/restart`, {}),
};
