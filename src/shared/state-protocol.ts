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

/** How a Claude Session is operated: in a terminal (Claude TUI) or in a conversation (Claude Agent). */
export type ClaudeInterface = "tui" | "agent";

/**
 * What the New Session dialog offers, and what the Host remembers as the kind created last.
 * "claude" is Claude TUI. Not what a Session is: that is `SessionKind` and `ClaudeInterface`.
 */
export type NewSessionKind = SessionKind | "claude-agent";

/**
 * What a running Claude Agent is doing. `waiting` is Waiting for you: an Allow/Deny ask is
 * open. A Stopped Agent has none of these: its `status` is "stopped".
 */
export type AgentActivity = "idle" | "working" | "waiting";

/** What the server reports of a running Claude Agent, from its runtime's status connection. */
export interface AgentState {
  state: AgentActivity;
  /** When the turn now running began (ms since the epoch, the Host's clock), while it runs. */
  turnStartedAt?: number;
  /** The `claude` the runtime drives. */
  claudeVersion?: string;
  /** Which build of the Agent Runtime is running (the SHA-256 of its file). */
  runtimeBuildId?: string;
  /**
   * True when k-bench has been updated to a build of the Agent Runtime other than the one
   * this Agent runs (their build IDs differ). The Agent keeps working as it is; restarting it
   * onto the new build is the owner's call. Absent otherwise: an update that left the runtime
   * unchanged shows nothing.
   */
  updateAvailable?: boolean;
  /**
   * The subagents and background tasks running now, as the runtime's `status.tasks` lists
   * them (the same shape as `AgentTask` in agent-protocol.ts); absent when there are none.
   * Open in terminal reads it to say what would stop.
   */
  tasks?: Array<{
    id: string;
    kind: "subagent" | "background";
    description: string;
  }>;
}

export interface SessionState {
  id: string;
  name: string;
  kind: SessionKind;
  /** For a Claude Session, the interface it is in now; absent for a shell. */
  interface?: ClaudeInterface;
  status: "running" | "stopped";
  /**
   * For a running Claude Agent, what it is doing. Absent for anything else, and for an Agent
   * whose runtime the server has not heard from yet (just started, or the server just did).
   */
  agent?: AgentState;
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
