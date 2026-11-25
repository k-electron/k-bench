import type { State, WorkspaceState } from "../../src/shared/state-protocol.ts";

/** What the views read off the state about the Workspaces. */

/** The Open Workspace, if there is one. */
export function findOpenWorkspace(state: State | undefined): WorkspaceState | undefined {
  return state?.workspaces.find((w) => w.id === state.openWorkspaceId);
}

/** Some Session of the Workspace has a Bell. */
export function hasBell(workspace: WorkspaceState): boolean {
  return workspace.sessions.some((session) => session.bell);
}
