import { useCallback, useLayoutEffect, useState } from "react";

/**
 * The per-device Pane layout: how many Panes the main view shows, which Session is in
 * each, which Pane is the Focused Pane, and where the divider sits.
 *
 * The functions below are pure (Layout in, Layout out) so the same rules can drive the
 * desktop and, later, the phone layout. `useLayout` adds storage on top.
 */
export interface Layout {
  /** 1 or 2 Panes are shown. */
  paneCount: 1 | 2;
  /**
   * The Session in each Pane (`null` for an empty Pane). The second slot keeps its
   * Session while only one Pane is shown, so toggling back restores it.
   */
  sessions: [string | null, string | null];
  /** Which Pane is the Focused Pane. Always 0 while only one Pane is shown. */
  focus: 0 | 1;
  /** Share of the width the first Pane takes when two are shown. */
  ratio: number;
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

export const defaultLayout: Layout = {
  paneCount: 1,
  sessions: [null, null],
  focus: 0,
  ratio: 0.5,
};

/**
 * The CSS grid columns of the main view: one column, or two with the divider's 6px between.
 * The Panes and the labels above them share this, so a label sits over its own Pane.
 */
export function paneColumns(layout: Layout): string {
  return layout.paneCount === 2
    ? `minmax(0, ${layout.ratio}fr) 6px minmax(0, ${1 - layout.ratio}fr)`
    : "minmax(0, 1fr)";
}

/** The Session shown in the Focused Pane, if any. */
export function focusedSession(layout: Layout): string | null {
  return layout.sessions[layout.focus];
}

/**
 * Puts `id` in the Pane `target`. A Session is never in both Panes: if the other Pane has
 * it, the two swap.
 */
function place(layout: Layout, id: string, target: 0 | 1): Layout {
  const other = target === 0 ? 1 : 0;
  const sessions: [string | null, string | null] = [...layout.sessions];
  if (sessions[target] === id) return layout;
  if (sessions[other] === id) sessions[other] = sessions[target];
  sessions[target] = id;
  return { ...layout, sessions };
}

/** Opens a Session in the Focused Pane (plain click on a sidebar row). */
export function openInFocusedPane(layout: Layout, id: string): Layout {
  return place(layout, id, layout.focus);
}

/** Opens a Session in the other Pane, showing it if only one Pane is visible. */
export function openInOtherPane(layout: Layout, id: string): Layout {
  return place({ ...layout, paneCount: 2 }, id, layout.focus === 0 ? 1 : 0);
}

/** Goes down to one Pane, keeping the Focused Pane's Session (the phone is always this). */
export function onePane(layout: Layout): Layout {
  if (layout.paneCount === 1) return layout;
  const [first, second] = layout.sessions;
  return {
    ...layout,
    paneCount: 1,
    focus: 0,
    sessions: layout.focus === 0 ? [first, second] : [second, first],
  };
}

/** Switches between one and two Panes. Going down to one keeps the Focused Pane's Session. */
export function togglePaneCount(layout: Layout): Layout {
  if (layout.paneCount === 1) return { ...layout, paneCount: 2 };
  return onePane(layout);
}

/** Moves the focus to the other Pane (⌘\). With one Pane there is nothing to move to. */
export function moveFocus(layout: Layout): Layout {
  if (layout.paneCount === 1) return layout;
  return { ...layout, focus: layout.focus === 0 ? 1 : 0 };
}

/** Focuses a given Pane (clicking in it). */
export function focusPane(layout: Layout, pane: 0 | 1): Layout {
  if (layout.paneCount === 1 || layout.focus === pane) return layout;
  return { ...layout, focus: pane };
}

/** Sets the divider position, kept within what leaves both Panes usable. */
export function setRatio(layout: Layout, ratio: number): Layout {
  const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  return clamped === layout.ratio ? layout : { ...layout, ratio: clamped };
}

/** Empties any Pane showing a Session that no longer exists. */
export function forgetMissingSessions(layout: Layout, existing: Set<string>): Layout {
  const [a, b] = layout.sessions;
  const keep = (id: string | null) => (id && existing.has(id) ? id : null);
  if (keep(a) === a && keep(b) === b) return layout;
  return { ...layout, sessions: [keep(a), keep(b)] };
}

/** Reads a stored layout, falling back to the default if it is missing or malformed. */
export function parseLayout(raw: string | null): Layout {
  if (!raw) return defaultLayout;
  try {
    const value = JSON.parse(raw) as Partial<Layout> | null;
    const sessions = value?.sessions;
    const slot = (x: unknown) => (typeof x === "string" ? x : null);
    if (
      !value ||
      (value.paneCount !== 1 && value.paneCount !== 2) ||
      (value.focus !== 0 && value.focus !== 1) ||
      typeof value.ratio !== "number" ||
      !Array.isArray(sessions) ||
      sessions.length !== 2
    ) {
      return defaultLayout;
    }
    const first = slot(sessions[0]);
    const second = slot(sessions[1]);
    return {
      paneCount: value.paneCount,
      sessions: [first, second !== first ? second : null],
      focus: value.paneCount === 1 ? 0 : value.focus,
      ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, value.ratio)),
    };
  } catch {
    return defaultLayout;
  }
}

const KEY = "k-bench.layout";

function load(): Layout {
  try {
    return parseLayout(localStorage.getItem(KEY));
  } catch {
    return defaultLayout;
  }
}

function save(layout: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable: the layout just doesn't survive a reload.
  }
}

/**
 * The layout, remembered on this device. `update` applies one of the pure functions
 * above, e.g. `update((l) => openInFocusedPane(l, id))`.
 */
export function useLayout(): [Layout, (change: (layout: Layout) => Layout) => void] {
  const [layout, setLayout] = useState<Layout>(load);
  // Saved before the browser paints, so a layout on screen is always the one stored: with a
  // passive effect, a reload right after a divider drag could restore the drag's last step.
  useLayoutEffect(() => save(layout), [layout]);
  const update = useCallback(
    (change: (layout: Layout) => Layout) => setLayout(change),
    [],
  );
  return [layout, update];
}
