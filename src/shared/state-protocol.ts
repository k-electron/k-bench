/**
 * The state protocol, the one definition the server, the browser and the test harness all
 * use. The server pushes the Workspaces and Sessions as full snapshots on the events
 * WebSocket (`GET /api/events`), and answers every successful change request with a
 * `State-Revision` header naming the snapshot from which the change shows (see `StateFeed`
 * on the server).
 *
 * Imported by the browser too, so this file has no imports and no Node APIs.
 */

/** What a Session runs: the owner's shell, or Claude Code (a Claude Session). */
export type SessionKind = "shell" | "claude";

/**
 * Which of a Workspace's two fixed Claude Sessions a Session is: its Prime or its Worker.
 * A Session with no role is an Other Session.
 */
export type SessionRole = "prime" | "worker";

export interface SessionState {
  id: string;
  name: string;
  kind: SessionKind;
  role: SessionRole | null;
  status: "running" | "stopped";
  /** The Session's program rang the terminal bell and nobody has seen it since. */
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
export interface State {
  workspaces: WorkspaceState[];
  /**
   * The Open Workspace, the one the main view shows on every device: the one last opened,
   * else the first by position. Null when there are no Workspaces.
   */
  openWorkspaceId: string | null;
}

/**
 * What the events WebSocket pushes: the state, plus the revision it is fresh to. A change
 * request answers with the revision whose snapshot first shows it. Revisions start again
 * from 0 when the server restarts.
 */
export type Snapshot = State & { revision: number };

/** The header a successful change request answers with: the revision that shows it. */
export const REVISION_HEADER = "State-Revision";

/** The path of the events WebSocket. */
export const EVENTS_PATH = "/api/events";

/** The text frame the server sends for `state` at `revision`. */
export function encodeSnapshot(state: State, revision: number): string {
  return JSON.stringify({ revision, ...state });
}

/** The snapshot a text frame holds, or undefined when it is not one. */
export function decodeSnapshot(text: string): Snapshot | undefined {
  let snapshot: Partial<Snapshot> | null;
  try {
    snapshot = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    typeof snapshot.revision !== "number" ||
    !Array.isArray(snapshot.workspaces)
  ) {
    return undefined;
  }
  return snapshot as Snapshot;
}

/**
 * The revision a response's headers name, from which snapshots show its change. NaN when
 * the header is missing: no snapshot reaches NaN, so a wait for it times out.
 */
export function revisionOf(headers: { get(name: string): string | null }): number {
  return Number(headers.get(REVISION_HEADER) ?? Number.NaN);
}
