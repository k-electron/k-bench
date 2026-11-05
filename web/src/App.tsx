import { Columns2Icon, MenuIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ExtraKeys } from "@/components/ExtraKeys";
import { PaneArea } from "@/components/PaneArea";
import { locateSession, PaneLabels } from "@/components/PaneLabels";
import { Sidebar } from "@/components/Sidebar";
import { TypingKeys } from "@/components/TypingKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  focusedSession,
  focusPane,
  forgetMissingSessions,
  type Layout,
  moveFocus,
  onePane,
  openInFocusedPane,
  openInOtherPane,
  setRatio,
  togglePaneCount,
  useLayout,
} from "./layout";
import { ActionsProvider, useAppState } from "./useAppState";
import { useIsPhone } from "./useIsPhone";
import { useKeyboardUp } from "./useKeyboardUp";

const DELETED_NOTICE = "This Session was deleted.";

/**
 * The app shell. On desktop, the sidebar beside the main view (one or two Panes). On a
 * phone, one Pane filling the screen, the sidebar in a slide-out drawer, and the extra keys.
 */
export function App() {
  const { state, actions, error } = useAppState();
  const phone = useIsPhone();
  // With the on-screen keyboard up the app fits the space above it, minus the header and
  // the Extra keys row, which a compact overlay on the terminal replaces.
  const keyboardUp = useKeyboardUp(phone);
  const [stored, updateStored] = useLayout();
  // The phone has one Pane; the same stored layout drives it, showing the Focused Pane.
  const layout = phone ? onePane(stored) : stored;
  const update = useCallback(
    (change: (layout: Layout) => Layout) =>
      updateStored((l) => change(phone ? onePane(l) : l)),
    [phone, updateStored],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerShown = phone && drawerOpen;
  useEffect(() => {
    if (!drawerShown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerShown]);

  const sessions = state?.workspaces.flatMap((w) => w.sessions) ?? [];

  // The tab is titled after the Focused Pane's Session.
  const focused = locateSession(state?.workspaces, focusedSession(layout));
  const title = focused
    ? `${focused.session.name} · ${focused.workspace} — k-bench`
    : "k-bench";
  useEffect(() => {
    document.title = title;
  }, [title]);

  // A Session deleted (here or on another device) empties its Pane, with a notice, rather
  // than reconnecting to nothing.
  const [notices, setNotices] = useState<[string | null, string | null]>([null, null]);
  useEffect(() => {
    if (!state) return;
    const existing = new Set(
      state.workspaces.flatMap((w) => w.sessions.map((s) => s.id)),
    );
    const gone = (id: string | null) => id !== null && !existing.has(id);
    const [a, b] = layout.sessions;
    // A Pane showing a Session has no notice; one whose Session just vanished gets one.
    const next = (id: string | null, notice: string | null) =>
      id === null ? notice : gone(id) ? DELETED_NOTICE : null;
    setNotices(([na, nb]) => [next(a, na), next(b, nb)]);
    // The saved layout, not the phone's one-Pane view: forgetting a Session needs only ids,
    // and saving the view would drop the second Pane whenever the window turns phone-sized.
    updateStored((l) => forgetMissingSessions(l, existing));
  }, [state, layout.sessions, updateStored]);

  // ⌘\ moves focus between Panes. Capture, so the terminal never sees the keystroke.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && event.key === "\\") {
        event.preventDefault();
        event.stopPropagation();
        update(moveFocus);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [update]);

  return (
    <ActionsProvider value={actions}>
      <div
        className={cn(
          "flex h-full",
          keyboardUp && "fixed inset-x-0 top-(--app-top) h-(--app-height)",
        )}
      >
        {drawerShown && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <Sidebar
          className={cn(
            phone
              ? "fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] border-r transition-[transform,visibility]"
              : "w-64",
            phone && !drawerOpen && "invisible -translate-x-full",
          )}
          state={state}
          openId={focusedSession(layout) ?? undefined}
          onOpen={(id) => {
            update((l) => openInFocusedPane(l, id));
            setDrawerOpen(false);
          }}
          onOpenInOtherPane={(id) => update((l) => openInOtherPane(l, id))}
          onCreateSession={async (workspaceId) => {
            // Resolves once the new Session is in state, so the Pane knows it.
            const id = await actions.createSession(workspaceId);
            if (id === undefined) return;
            update((l) => openInFocusedPane(l, id));
            setDrawerOpen(false);
          }}
          error={error}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {!keyboardUp && (
            <div className="relative flex h-9 shrink-0 items-center border-b">
              {phone && (
                <Button
                  className="ml-2"
                  variant="ghost"
                  size="sm"
                  aria-label="Menu"
                  onClick={() => setDrawerOpen(true)}
                >
                  <MenuIcon />
                </Button>
              )}
              {/* On a phone the labels start after the Menu button; on desktop they span the
                  bar, over the Panes' own columns, with the toggle on top at the right. */}
              <PaneLabels
                layout={layout}
                workspaces={state?.workspaces}
                className={phone ? "flex-1" : "absolute inset-0"}
              />
              {!phone && (
                <Button
                  className="relative mr-2 ml-auto"
                  variant={layout.paneCount === 2 ? "secondary" : "ghost"}
                  size="sm"
                  aria-label="Two panes"
                  aria-pressed={layout.paneCount === 2}
                  onClick={() => update(togglePaneCount)}
                >
                  <Columns2Icon />
                </Button>
              )}
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <PaneArea
              layout={layout}
              sessions={sessions}
              notices={notices}
              emptyMessage={
                state?.workspaces.length === 0
                  ? "Create a Workspace to get started."
                  : "Select a Session."
              }
              onFocus={(pane) => update((l) => focusPane(l, pane))}
              onResize={(ratio) => update((l) => setRatio(l, ratio))}
            />
            {keyboardUp && focusedSession(layout) && <TypingKeys />}
          </div>
          {phone && !keyboardUp && focusedSession(layout) && <ExtraKeys />}
        </main>
      </div>
    </ActionsProvider>
  );
}
