import { useEffect, useRef, useState } from "react";
import type {
  SessionState,
  State,
  WorkspaceState,
} from "../../src/shared/state-protocol.ts";
import { forgetSmartTypingOfMissing } from "./smartTyping";
import type { Actions } from "./useAppState";

/** What a Pane shows. */
export type PaneContent =
  | { kind: "session"; session: SessionState }
  /** Nothing to show: there is no Open Workspace (no Workspaces at all). */
  | { kind: "empty" };

export type Side = "left" | "right";

/**
 * What the right Pane shows for one Workspace: an Other Session's id, or null for the
 * Worker.
 */
export type RightPaneShown = string | null;

export interface WorkspaceView {
  /** The Open Workspace, which the main view belongs to. */
  workspace: WorkspaceState | undefined;
  /** The left Pane: always the Prime. */
  left: PaneContent;
  /** The right Pane: the Worker, or the Other Session the owner opened there. */
  right: PaneContent;
  /** Share of the width the left Pane takes. */
  ratio: number;
  /**
   * The Pane whose terminal should have the keyboard: the one the owner last chose
   * something for, or last clicked into.
   */
  focus: Side;
  /** The Sessions on screen, one per Pane, for the sidebar's highlight. */
  shown: ReadonlySet<string>;
  /**
   * Opens a Workspace (choosing it by name): makes it the Open Workspace on the Host, which
   * starts its Stopped Prime and Worker, and brings back Prime with Worker.
   */
  openWorkspace(id: string): void;
  /** Shows the Prime (it is always in the left Pane, so this gives it the keyboard). */
  showPrime(): void;
  /** Shows the Worker in the right Pane. */
  showWorker(): void;
  /** Opens an Other Session of the Open Workspace into the right Pane. */
  openOtherSession(workspaceId: string, sessionId: string): void;
  /**
   * A Session of the Open Workspace chosen in the sidebar: the Prime, the Worker or an
   * Other Session.
   */
  chooseSession(workspaceId: string, session: SessionState): void;
  /** The owner clicked into a Pane. */
  focusPane(side: Side): void;
  setRatio(ratio: number): void;
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/**
 * Where the browser kept the Pane layout before Workspaces owned the main view. It is
 * deleted on load, which throws old layouts away on upgrade.
 */
const RETIRED_LAYOUT_KEY = "k-bench.layout";

/** The two Panes of a Workspace, given what its right Pane is set to show. */
export function workspacePanes(
  workspace: WorkspaceState | undefined,
  rightShown: RightPaneShown,
): { left: PaneContent; right: PaneContent } {
  const content = (session: SessionState | undefined): PaneContent =>
    session ? { kind: "session", session } : { kind: "empty" };
  const sessions = workspace?.sessions ?? [];
  const prime = sessions.find((s) => s.role === "prime");
  const worker = sessions.find((s) => s.role === "worker");
  // An Other Session that was deleted (here or on another device) gives way to the Worker.
  const other = sessions.find((s) => s.id === rightShown && s.role === null);
  return { left: content(prime), right: content(other ?? worker) };
}

/**
 * The desktop and tablet view of the Open Workspace: the Prime in the left Pane, and the
 * Worker or one Other Session in the right.
 *
 * The Open Workspace comes from the state on every render, so every device follows it.
 * What the right Pane shows, and the divider, are kept per Workspace in memory for now.
 *
 * It also does what any device does on load, whatever its size: it opens the Open
 * Workspace once, deletes the retired saved layout, and forgets Smart typing choices of
 * Sessions that no longer exist.
 */
export function useWorkspaceView(
  state: State | undefined,
  actions: Actions,
): WorkspaceView {
  const [rightShown, setRightShown] = useState<Record<string, RightPaneShown>>({});
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<Side>("left");

  const workspace = state?.workspaces.find((w) => w.id === state.openWorkspaceId);
  const { left, right } = workspacePanes(
    workspace,
    workspace ? (rightShown[workspace.id] ?? null) : null,
  );

  useOpenOnLoad(state, actions);

  useEffect(() => {
    try {
      localStorage.removeItem(RETIRED_LAYOUT_KEY);
    } catch {
      // Storage unavailable: there is no saved layout to throw away either.
    }
  }, []);

  useEffect(() => {
    if (!state) return;
    forgetSmartTypingOfMissing(
      new Set(state.workspaces.flatMap((w) => w.sessions.map((s) => s.id))),
    );
  }, [state]);

  const title = workspace ? `${workspace.name} — k-bench` : "k-bench";
  useEffect(() => {
    document.title = title;
  }, [title]);

  const openId = workspace?.id;
  const showOnRight = (workspaceId: string, shown: RightPaneShown) => {
    setRightShown((current) => ({ ...current, [workspaceId]: shown }));
    setFocus("right");
  };

  const openWorkspace = (id: string) => {
    setRightShown((current) => ({ ...current, [id]: null }));
    setFocus("left");
    void actions.openWorkspace(id);
  };

  const shown = new Set<string>();
  for (const pane of [left, right])
    if (pane.kind === "session") shown.add(pane.session.id);

  return {
    workspace,
    left,
    right,
    ratio: (openId && ratios[openId]) || 0.5,
    focus,
    shown,
    openWorkspace,
    showPrime: () => setFocus("left"),
    showWorker: () => {
      if (openId) showOnRight(openId, null);
    },
    openOtherSession: (workspaceId, sessionId) => showOnRight(workspaceId, sessionId),
    chooseSession: (workspaceId, session) => {
      if (session.role === "worker") showOnRight(workspaceId, null);
      else if (session.role === null) showOnRight(workspaceId, session.id);
      else setFocus("left");
    },
    focusPane: setFocus,
    setRatio: (ratio) => {
      if (!openId) return;
      const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
      setRatios((current) => ({ ...current, [openId]: clamped }));
    },
  };
}

/**
 * Opens the Open Workspace once, when the first state arrives, so every device lands on
 * it with its Prime and Worker started. Only once per load: a Prime the owner quits stays
 * Stopped until they open the Workspace again, so a reconnect must not reopen it.
 */
function useOpenOnLoad(state: State | undefined, actions: Actions): void {
  const opened = useRef(false);
  useEffect(() => {
    if (!state || opened.current) return;
    opened.current = true;
    if (state.openWorkspaceId) void actions.openWorkspace(state.openWorkspaceId);
  }, [state, actions]);
}
