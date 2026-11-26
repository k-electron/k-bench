import type {
  SessionState,
  State,
  WorkspaceState,
} from "../../src/shared/state-protocol.ts";

/** What the views read off the state about the Workspaces and their Sessions. */

/** What a Session's one marker can show, the most urgent first. */
export type Marker = "waiting" | "bell" | "working" | "idle";

/**
 * The one marker a Session shows, the most urgent first: Waiting, its Bell, then Working or
 * Idle. A Stopped Session shows none (only its "stopped" badge), and a shell has no state,
 * so it shows only a Bell.
 */
export function sessionMarker(session: SessionState): Marker | null {
  if (session.status === "stopped") return null;
  if (session.activity === "waiting") return "waiting";
  if (session.bell) return "bell";
  return session.activity;
}

/** The Open Workspace, if there is one. */
export function findOpenWorkspace(state: State | undefined): WorkspaceState | undefined {
  return state?.workspaces.find((w) => w.id === state.openWorkspaceId);
}

/** Some Session of the Workspace has a Bell. */
export function hasBell(workspace: WorkspaceState): boolean {
  return workspace.sessions.some((session) => session.bell);
}

/**
 * The marker a folded Workspace's tile carries for its Sessions: Waiting when any of them is,
 * then a Bell. Working and Idle never roll up to the tile.
 */
export function workspaceMarker(workspace: WorkspaceState): "waiting" | "bell" | null {
  if (workspace.sessions.some((session) => sessionMarker(session) === "waiting")) {
    return "waiting";
  }
  return hasBell(workspace) ? "bell" : null;
}
