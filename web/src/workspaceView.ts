import { useCallback, useEffect, useRef, useState } from "react";
import { sessionsByRole } from "../../src/shared/session-roles.ts";
import type {
  RightPaneState,
  SessionState,
  State,
  WorkspaceState,
} from "../../src/shared/state-protocol.ts";
import { forgetSmartTypingOfMissing } from "./smartTyping";
import type { Actions } from "./useAppState";
import { findOpenWorkspace } from "./workspaces";

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
  /**
   * Share of the width the left Pane takes while both are open. While one is shut, the
   * share it reopens at.
   */
  ratio: number;
  /** The shut Pane, which shows only a rail, if either is. */
  shut: Side | null;
  /**
   * The Pane whose terminal should have the keyboard: the one the owner last chose
   * something for, or last clicked into, unless that one is shut.
   */
  focusedTerminal: Side;
  /**
   * The Open Workspace is being opened, which starts its Stopped Prime and Worker: their
   * Panes wait for their terminals rather than offering Restart.
   */
  starting: boolean;
  /** The Sessions on screen in an open Pane, for the sidebar's highlight. */
  shown: ReadonlySet<string>;
  /**
   * Opens a Workspace (choosing it by name): makes it the Open Workspace on the Host, which
   * starts its Stopped Prime and Worker, and brings back Prime with Worker.
   */
  openWorkspace(id: string): void;
  /**
   * Makes a Workspace the Open Workspace on the Host, which starts its Stopped Prime and
   * Worker, leaving its right Pane and this device's divider alone: the phone's open by name.
   * `starting` covers it as for `openWorkspace`.
   */
  open(id: string): void;
  /**
   * Shows the Prime (it is always in the left Pane, so this gives it the keyboard).
   * Opening anything into a shut Pane reopens it.
   */
  showPrime(): void;
  /** Shows the Worker in the right Pane. */
  showWorker(): void;
  /**
   * Opens an Other Session of the Open Workspace into the right Pane, adding a tab for it
   * if it has none.
   */
  openOtherSession(workspaceId: string, sessionId: string): void;
  /**
   * Removes an Other Session's tab from the right Pane; the Session keeps running. Closing
   * the tab shown brings back the Worker.
   */
  closeTab(sessionId: string): void;
  /**
   * A Session of the Open Workspace chosen in the sidebar: the Prime, the Worker or an
   * Other Session.
   */
  chooseSession(workspaceId: string, session: SessionState): void;
  /** The owner clicked into a Pane's terminal. */
  focusTerminal(side: Side): void;
  /**
   * Moves the divider. Within `SHUT_EDGE` of an edge it shuts that Pane, which reopens at
   * `reopenAt`: where the divider was before the drag that shut it. It defaults to the
   * current ratio, which is right for anything but a drag.
   */
  setRatio(ratio: number, reopenAt?: number): void;
  /** Reopens a shut Pane where the divider was before it was shut. */
  reopen(side: Side): void;
}

/** How close to an edge, as a share of the width, the divider shuts that Pane. */
export const SHUT_EDGE = 0.08;

/** Where the divider sits for one Workspace on this device. */
export interface Divider {
  /** As `WorkspaceView.ratio`. */
  ratio: number;
  shut: Side | null;
}

const HALF_AND_HALF: Divider = { ratio: 0.5, shut: null };

/** Where the divider sits after it is moved to `ratio`. */
export function moveDivider(ratio: number, reopenAt: number): Divider {
  if (ratio < SHUT_EDGE) return { ratio: reopenAt, shut: "left" };
  if (ratio > 1 - SHUT_EDGE) return { ratio: reopenAt, shut: "right" };
  return { ratio, shut: null };
}

/**
 * Where the browser keeps each Workspace's divider, which stays on this device: a laptop and
 * an iPad can each be set up their own way.
 */
const DIVIDERS_KEY = "k-bench.dividers";

function isDivider(value: unknown): value is Divider {
  if (typeof value !== "object" || value === null) return false;
  const { ratio, shut } = value as Record<string, unknown>;
  return (
    typeof ratio === "number" &&
    ratio > 0 &&
    ratio < 1 &&
    (shut === null || shut === "left" || shut === "right")
  );
}

function loadDividers(): Record<string, Divider> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DIVIDERS_KEY) ?? "{}");
    if (typeof saved !== "object" || saved === null) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, divider]) => isDivider(divider)),
    );
  } catch {
    // Storage unavailable or garbled: every Workspace starts half and half.
    return {};
  }
}

function saveDividers(dividers: Record<string, Divider>): void {
  try {
    localStorage.setItem(DIVIDERS_KEY, JSON.stringify(dividers));
  } catch {
    // Storage unavailable: the dividers last until the page is closed.
  }
}

const otherSide = (side: Side): Side => (side === "left" ? "right" : "left");

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
  const { prime, worker, others: otherList } = sessionsByRole(sessions);
  const others = new Map(otherList.map((s) => [s.id, s]));
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
 * the state on the Host, so every device follows them. The divider, and which Pane is
 * shut, are kept per Workspace in this browser's storage.
 *
 * It also does what any device does on load, whatever its size: it opens the Open
 * Workspace once, deletes the retired saved layout, and forgets Smart typing choices of
 * Sessions that no longer exist.
 */
export function useWorkspaceView(
  state: State | undefined,
  actions: Actions,
): WorkspaceView {
  const [dividers, setDividers] = useState(loadDividers);
  const [focused, setFocused] = useState<Side>("left");
  // How many open requests are in flight.
  const [opening, setOpening] = useState(0);
  const open = useCallback(
    (id: string, options?: { showWorker?: boolean }) => {
      setOpening((n) => n + 1);
      void actions.openWorkspace(id, options).finally(() => setOpening((n) => n - 1));
    },
    [actions],
  );

  const workspace = findOpenWorkspace(state);
  const { left, right, worker, tabs } = workspacePanes(workspace);
  // The latest state, for changes made after an await (a new Session opening once it is
  // in state) or before the next render, so they build on the right Pane as it is now.
  const latest = useRef(state);
  latest.current = state;

  const openedOnLoad = useOpenOnLoad(state, open);

  useEffect(() => saveDividers(dividers), [dividers]);

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
  const divider = (openId && dividers[openId]) || HALF_AND_HALF;

  /** Reopens a Workspace's Pane if it is shut, where the divider was before. */
  const reopen = useCallback((workspaceId: string, side: Side) => {
    setDividers((current) => {
      const was = current[workspaceId];
      if (was?.shut !== side) return current;
      return { ...current, [workspaceId]: { ratio: was.ratio, shut: null } };
    });
  }, []);

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
      setFocused("right");
      reopen(workspaceId, "right");
    },
    [changeRightPane, reopen],
  );

  const showPrimeOf = (workspaceId: string) => {
    setFocused("left");
    reopen(workspaceId, "left");
  };

  const openWorkspace = (id: string) => {
    setFocused("left");
    // The Workspace's name brings back the Worker, so a shut right Pane opens again.
    reopen(id, "right");
    open(id, { showWorker: true });
  };

  const shown = new Set<string>();
  if (divider.shut !== "left" && left.kind === "session") shown.add(left.session.id);
  if (divider.shut !== "right" && right.kind === "session") shown.add(right.session.id);

  return {
    workspace,
    left,
    right,
    worker,
    tabs,
    ratio: divider.ratio,
    shut: divider.shut,
    focusedTerminal: focused === divider.shut ? otherSide(focused) : focused,
    starting: !openedOnLoad || opening > 0,
    shown,
    openWorkspace,
    open,
    showPrime: () => {
      if (openId) showPrimeOf(openId);
    },
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
      else showPrimeOf(workspaceId);
    },
    focusTerminal: setFocused,
    setRatio: (ratio, reopenAt = divider.ratio) => {
      if (!openId) return;
      setDividers((current) => ({ ...current, [openId]: moveDivider(ratio, reopenAt) }));
    },
    reopen: (side) => {
      if (openId) reopen(openId, side);
    },
  };
}

/**
 * Opens the Open Workspace once, when the first state arrives, so every device lands on
 * it with its Prime and Worker started, and says whether it has. Only once per load: a
 * Prime the owner quits stays Stopped until they open the Workspace again, so a reconnect
 * must not reopen it.
 */
function useOpenOnLoad(state: State | undefined, open: (id: string) => void): boolean {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!state || opened) return;
    setOpened(true);
    if (state.openWorkspaceId) open(state.openWorkspaceId);
  }, [state, open, opened]);
  return opened;
}
