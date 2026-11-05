import { useCallback, useEffect, useState } from "react";
import type { SessionState, State } from "../../src/shared/state-protocol.ts";
import {
  focusPane,
  forgetMissingSessions,
  moveFocus,
  openInFocusedPane,
  openInOtherPane,
  setRatio,
  stashInOtherPane,
  togglePaneCount,
  useLayout,
} from "./layout";

/** What a visible Pane shows. */
export type PaneContent =
  | { kind: "session"; session: SessionState; workspace: string }
  /** Its Session was deleted (here or on another device). */
  | { kind: "deleted" }
  | { kind: "empty" };

export interface PaneView {
  /** The saved Pane this is: 0 is the first, 1 the second. */
  pane: 0 | 1;
  content: PaneContent;
  focused: boolean;
}

export interface PaneViewModel {
  /** The Panes to lay out: one on a phone, otherwise as many as were saved. */
  panes: PaneView[];
  /** How many Panes are laid out (`panes.length`). */
  paneCount: 1 | 2;
  /** Share of the width the first Pane takes, when two are laid out. */
  ratio: number;
  /** The Session in the Focused Pane, if it has one. */
  focusedSessionId: string | undefined;
  /** Plain click on a Session: opens it in the Focused Pane. */
  openInFocusedPane(sessionId: string): void;
  /** Opens a Session in the other Pane. On a phone this is not visible. */
  openInOtherPane(sessionId: string): void;
  /** Focuses a Pane (clicking in it), given as `PaneView.pane`. */
  focusPane(pane: 0 | 1): void;
  togglePaneCount(): void;
  setRatio(ratio: number): void;
}

/**
 * Owns the Panes: the layout saved on this device, and what each Pane shows given the
 * Sessions that exist. The phone's one-Pane view is applied when reading only: being
 * phone-sized, or acting while phone-sized, never changes the saved layout beyond what the
 * action asks for. Every intent changes the saved layout, and on a phone acts on what the
 * phone shows, the saved layout's Focused Pane.
 */
export function usePaneView(state: State | undefined, phone: boolean): PaneViewModel {
  const [saved, update] = useLayout();

  // A Session deleted (here or on another device) empties its Pane, with a notice, rather
  // than reconnecting to nothing. The notice belongs to a saved Pane, not to a visible
  // slot, so it stays with the right Pane when the window is resized.
  const [notices, setNotices] = useState<[boolean, boolean]>([false, false]);
  const [a, b] = saved.sessions;
  useEffect(() => {
    if (!state) return;
    const existing = new Set(
      state.workspaces.flatMap((w) => w.sessions.map((s) => s.id)),
    );
    const gone = (id: string | null) => id !== null && !existing.has(id);
    // A Pane showing a Session has no notice; one whose Session just vanished gets one.
    const next = (id: string | null, notice: boolean) =>
      id === null ? notice : gone(id);
    setNotices(([na, nb]) => [next(a, na), next(b, nb)]);
    update((l) => forgetMissingSessions(l, existing));
  }, [state, a, b, update]);

  // On a phone the one Pane is the saved Focused Pane, wherever it sits in the saved layout.
  const shown: Array<0 | 1> =
    !phone && saved.paneCount === 2 ? [0, 1] : [phone ? saved.focus : 0];

  const panes = shown.map((pane): PaneView => {
    const id = saved.sessions[pane];
    let content: PaneContent = { kind: "empty" };
    for (const workspace of state?.workspaces ?? []) {
      const session = workspace.sessions.find((s) => s.id === id);
      if (session) {
        content = { kind: "session", session, workspace: workspace.name };
        break;
      }
    }
    if (content.kind === "empty" && state && (id !== null || notices[pane])) {
      content = { kind: "deleted" };
    }
    return { pane, content, focused: saved.focus === pane || shown.length === 1 };
  });

  const focused = panes.find((p) => p.focused)?.content;
  const focusedSession = focused?.kind === "session" ? focused : undefined;
  const title = focusedSession
    ? `${focusedSession.session.name} · ${focusedSession.workspace} — k-bench`
    : "k-bench";
  useEffect(() => {
    document.title = title;
  }, [title]);

  const moveFocusIntent = useCallback(
    () => update((l) => (phone ? l : moveFocus(l))),
    [phone, update],
  );

  // ⌘\ moves focus between Panes. Capture, so the terminal never sees the keystroke.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && event.key === "\\") {
        event.preventDefault();
        event.stopPropagation();
        moveFocusIntent();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [moveFocusIntent]);

  return {
    panes,
    paneCount: shown.length === 2 ? 2 : 1,
    ratio: saved.ratio,
    focusedSessionId: focusedSession?.session.id,
    openInFocusedPane: (id) => update((l) => openInFocusedPane(l, id)),
    openInOtherPane: (id) =>
      update((l) => (phone ? stashInOtherPane(l, id) : openInOtherPane(l, id))),
    focusPane: (pane) => update((l) => focusPane(l, pane)),
    togglePaneCount: () => update((l) => (phone ? l : togglePaneCount(l))),
    setRatio: (ratio) => update((l) => setRatio(l, ratio)),
  };
}
