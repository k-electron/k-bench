import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RightPaneState,
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

export interface WorkspaceView {
  /** The Open Workspace, which the main view belongs to. */
  workspace: WorkspaceState | undefined;
  /** The left Pane: always the Prime. */
  left: PaneContent;
  /** The right Pane: the Worker, or the Other Session the owner opened there. */
  right: PaneContent;
  /** The Open Workspace's Worker, whose tab comes first in the right Pane. */
  worker: SessionState | undefined;
  /** The Other Sessions opened in the right Pane, as its tabs after the Worker's, in order. */
  tabs: SessionState[];
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
  /**
   * Opens an Other Session into the right Pane, adding a tab for it if it has none. Its
   * Workspace is opened first if it is not the Open Workspace.
   */
  openOtherSession(workspaceId: string, sessionId: string): void;
  /**
   * Removes an Other Session's tab from the right Pane; the Session keeps running. Closing
   * the tab shown brings back the Worker.
   */
  closeTab(sessionId: string): void;
  /**
   * A Session chosen in the sidebar, of any role and any Workspace: the Prime, the Worker
   * or an Other Session, opening its Workspace first if it is not the Open Workspace.
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

const NO_RIGHT_PANE: RightPaneState = { shown: null, tabs: [] };

/** The two Panes of a Workspace, and the right Pane's Worker and tabs. */
export function workspacePanes(workspace: WorkspaceState | undefined): {
  left: PaneContent;
  right: PaneContent;
  worker: SessionState | undefined;
  tabs: SessionState[];
} {
  const content = (session: SessionState | undefined): PaneContent =>
    session ? { kind: "session", session } : { kind: "empty" };
  const sessions = workspace?.sessions ?? [];
  const { shown, tabs } = workspace?.rightPane ?? NO_RIGHT_PANE;
  const others = new Map(sessions.filter((s) => s.role === null).map((s) => [s.id, s]));
  const prime = sessions.find((s) => s.role === "prime");
  const worker = sessions.find((s) => s.role === "worker");
  // An Other Session that was deleted (here or on another device) gives way to the Worker.
  const other = shown === null ? undefined : others.get(shown);
  return {
    left: content(prime),
    right: content(other ?? worker),
    worker,
    tabs: tabs.flatMap((id) => others.get(id) ?? []),
  };
}

/**
 * The desktop and tablet view of the Open Workspace: the Prime in the left Pane, and the
 * Worker or one Other Session in the right.
 *
 * The Open Workspace, and what each Workspace's right Pane shows and its tabs, come from
 * the state on the Host, so every device follows them. The divider is kept per Workspace
 * in memory for now.
 *
 * It also does what any device does on load, whatever its size: it opens the Open
 * Workspace once, deletes the retired saved layout, and forgets Smart typing choices of
 * Sessions that no longer exist.
 */
export function useWorkspaceView(
  state: State | undefined,
  actions: Actions,
): WorkspaceView {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<Side>("left");

  const workspace = state?.workspaces.find((w) => w.id === state.openWorkspaceId);
  const { left, right, worker, tabs } = workspacePanes(workspace);
  // The latest state, for changes made after an await (a new Session opening once it is
  // in state) or before the next render, so they build on the right Pane as it is now.
  const latest = useRef(state);
  latest.current = state;

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
  /** Changes a Workspace's right Pane, building on what it holds now. */
  const changeRightPane = useCallback(
    (workspaceId: string, change: (current: RightPaneState) => RightPaneState) => {
      const current =
        latest.current?.workspaces.find((w) => w.id === workspaceId)?.rightPane ??
        NO_RIGHT_PANE;
      void actions.setRightPane(workspaceId, change(current));
    },
    [actions],
  );
  const showOnRight = useCallback(
    (workspaceId: string, shown: string | null) => {
      changeRightPane(workspaceId, ({ tabs }) => ({
        shown,
        tabs: shown === null || tabs.includes(shown) ? tabs : [...tabs, shown],
      }));
      setFocus("right");
      if (workspaceId !== latest.current?.openWorkspaceId) {
        void actions.openWorkspace(workspaceId);
      }
    },
    [actions, changeRightPane],
  );

  const openWorkspace = (id: string) => {
    setFocus("left");
    void actions.openWorkspace(id, { showWorker: true });
  };

  const shown = new Set<string>();
  for (const pane of [left, right])
    if (pane.kind === "session") shown.add(pane.session.id);

  return {
    workspace,
    left,
    right,
    worker,
    tabs,
    ratio: (openId && ratios[openId]) || 0.5,
    focus,
    shown,
    openWorkspace,
    showPrime: () => setFocus("left"),
    showWorker: () => {
      if (openId) showOnRight(openId, null);
    },
    openOtherSession: (workspaceId, sessionId) => showOnRight(workspaceId, sessionId),
    closeTab: (sessionId) => {
      if (!openId) return;
      changeRightPane(openId, ({ shown, tabs }) => ({
        shown: shown === sessionId ? null : shown,
        tabs: tabs.filter((id) => id !== sessionId),
      }));
    },
    chooseSession: (workspaceId, session) => {
      if (session.role === "worker") showOnRight(workspaceId, null);
      else if (session.role === null) showOnRight(workspaceId, session.id);
      else {
        // The Prime. Another Workspace's opens it, keeping what its right Pane showed.
        setFocus("left");
        if (workspaceId !== openId) void actions.openWorkspace(workspaceId);
      }
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
