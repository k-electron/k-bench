import { useCallback, useEffect, useState } from "react";
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
  focus: Side;
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
   * Shows the Prime (it is always in the left Pane, so this gives it the keyboard).
   * Opening anything into a shut Pane reopens it.
   */
  showPrime(): void;
  /** Shows the Worker in the right Pane. */
  showWorker(): void;
  /**
   * Opens an Other Session into the right Pane. Its Workspace is opened first if it is
   * not the Open Workspace.
   */
  openOtherSession(workspaceId: string, sessionId: string): void;
  /**
   * A Session chosen in the sidebar, of any role and any Workspace: the Prime, the Worker
   * or an Other Session, opening its Workspace first if it is not the Open Workspace.
   */
  chooseSession(workspaceId: string, session: SessionState): void;
  /** The owner clicked into a Pane. */
  focusPane(side: Side): void;
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
export interface Split {
  /** As `WorkspaceView.ratio`. */
  ratio: number;
  shut: Side | null;
}

const HALF_AND_HALF: Split = { ratio: 0.5, shut: null };

/** The split after the divider is moved to `ratio`. */
export function moveDivider(ratio: number, reopenAt: number): Split {
  if (ratio < SHUT_EDGE) return { ratio: reopenAt, shut: "left" };
  if (ratio > 1 - SHUT_EDGE) return { ratio: reopenAt, shut: "right" };
  return { ratio, shut: null };
}

/**
 * Where the browser keeps each Workspace's split, which stays on this device: a laptop and
 * an iPad can each be set up their own way.
 */
const SPLITS_KEY = "k-bench.splits";

function isSplit(value: unknown): value is Split {
  if (typeof value !== "object" || value === null) return false;
  const { ratio, shut } = value as Record<string, unknown>;
  return (
    typeof ratio === "number" &&
    ratio > 0 &&
    ratio < 1 &&
    (shut === null || shut === "left" || shut === "right")
  );
}

function loadSplits(): Record<string, Split> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SPLITS_KEY) ?? "{}");
    if (typeof saved !== "object" || saved === null) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, split]) => isSplit(split)),
    );
  } catch {
    // Storage unavailable or garbled: every Workspace starts half and half.
    return {};
  }
}

function saveSplits(splits: Record<string, Split>): void {
  try {
    localStorage.setItem(SPLITS_KEY, JSON.stringify(splits));
  } catch {
    // Storage unavailable: the splits last until the page is closed.
  }
}

const otherSide = (side: Side): Side => (side === "left" ? "right" : "left");

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
 * What the right Pane shows is kept per Workspace in memory for now. The divider, and which
 * Pane is shut, are kept per Workspace in this browser's storage.
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
  const [splits, setSplits] = useState(loadSplits);
  const [focus, setFocus] = useState<Side>("left");
  // How many open requests are in flight.
  const [opening, setOpening] = useState(0);
  const open = useCallback(
    (id: string) => {
      setOpening((n) => n + 1);
      void actions.openWorkspace(id).finally(() => setOpening((n) => n - 1));
    },
    [actions],
  );

  const workspace = state?.workspaces.find((w) => w.id === state.openWorkspaceId);
  const { left, right } = workspacePanes(
    workspace,
    workspace ? (rightShown[workspace.id] ?? null) : null,
  );

  const openedOnLoad = useOpenOnLoad(state, open);

  useEffect(() => saveSplits(splits), [splits]);

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
  const split = (openId && splits[openId]) || HALF_AND_HALF;

  /** Reopens a Workspace's Pane if it is shut, where the divider was before. */
  const reopen = useCallback((workspaceId: string, side: Side) => {
    setSplits((current) => {
      const was = current[workspaceId];
      if (was?.shut !== side) return current;
      return { ...current, [workspaceId]: { ratio: was.ratio, shut: null } };
    });
  }, []);

  const showOnRight = useCallback(
    (workspaceId: string, shown: RightPaneShown) => {
      setRightShown((current) => ({ ...current, [workspaceId]: shown }));
      setFocus("right");
      reopen(workspaceId, "right");
      if (workspaceId !== openId) open(workspaceId);
    },
    [open, openId, reopen],
  );

  const showPrimeOf = (workspaceId: string) => {
    setFocus("left");
    reopen(workspaceId, "left");
  };

  const openWorkspace = (id: string) => {
    setRightShown((current) => ({ ...current, [id]: null }));
    setFocus("left");
    // The Workspace's name brings back the Worker, so a shut right Pane opens again.
    reopen(id, "right");
    open(id);
  };

  const shown = new Set<string>();
  if (split.shut !== "left" && left.kind === "session") shown.add(left.session.id);
  if (split.shut !== "right" && right.kind === "session") shown.add(right.session.id);

  return {
    workspace,
    left,
    right,
    ratio: split.ratio,
    shut: split.shut,
    focus: focus === split.shut ? otherSide(focus) : focus,
    starting: !openedOnLoad || opening > 0,
    shown,
    openWorkspace,
    showPrime: () => {
      if (openId) showPrimeOf(openId);
    },
    showWorker: () => {
      if (openId) showOnRight(openId, null);
    },
    openOtherSession: (workspaceId, sessionId) => showOnRight(workspaceId, sessionId),
    chooseSession: (workspaceId, session) => {
      if (session.role === "worker") showOnRight(workspaceId, null);
      else if (session.role === null) showOnRight(workspaceId, session.id);
      else {
        // The Prime. Another Workspace's opens it, keeping what its right Pane showed.
        showPrimeOf(workspaceId);
        if (workspaceId !== openId) open(workspaceId);
      }
    },
    focusPane: setFocus,
    setRatio: (ratio, reopenAt = split.ratio) => {
      if (!openId) return;
      setSplits((current) => ({ ...current, [openId]: moveDivider(ratio, reopenAt) }));
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
