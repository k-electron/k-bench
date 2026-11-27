/** What the views read off the state about the Workspaces and their Sessions. */

import type {
  SessionState,
  State,
  WorkspaceState,
} from "../../src/shared/state-protocol.ts";

/** What a Session's one marker can show, the most urgent first. */
export type Marker = "waiting" | "bell" | "working" | "idle";

/**
 * The markers that also show away from their Session, as a hint: on a folded Workspace's
 * tile and on the phone's Menu button.
 */
export type HintMarker = Extract<Marker, "waiting" | "bell">;

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

/**
 * The hint some Sessions give away from them: Waiting when any of them is, then a Bell.
 * Working and Idle never roll up.
 */
export function hintMarker(sessions: SessionState[]): HintMarker | null {
  if (sessions.some((session) => sessionMarker(session) === "waiting")) return "waiting";
  return sessions.some((session) => session.bell) ? "bell" : null;
}

/** The hint a folded Workspace's tile carries for its Sessions. */
export function workspaceMarker(workspace: WorkspaceState): HintMarker | null {
  return hintMarker(workspace.sessions);
}
