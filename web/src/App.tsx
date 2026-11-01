import { Columns2Icon, MenuIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ExtraKeys } from "@/components/ExtraKeys";
import { PaneArea } from "@/components/PaneArea";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiError, api } from "./api";
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
import { useAppState } from "./useAppState";
import { useIsPhone } from "./useIsPhone";

const DELETED_NOTICE = "This Session was deleted.";

/**
 * The app shell. On desktop, the sidebar beside the main view (one or two Panes). On a
 * phone, one Pane filling the screen, the sidebar in a slide-out drawer, and the extra keys.
 */
export function App() {
  const { state, refresh, reorderWorkspaces } = useAppState();
  const phone = useIsPhone();
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

  const [error, setError] = useState<string>();

  const sessions = state?.workspaces.flatMap((w) => w.sessions) ?? [];

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
    update((l) => forgetMissingSessions(l, existing));
  }, [state, layout.sessions, update]);

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
    <div className="flex h-full">
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
        onCreateWorkspace={async (input) => {
          await api.createWorkspace(input);
          await refresh();
        }}
        onReorderWorkspaces={reorderWorkspaces}
        onUpdateWorkspace={async (id, changes) => {
          await api.updateWorkspace(id, changes);
          await refresh();
        }}
        onDeleteWorkspace={async (id) => {
          await api.deleteWorkspace(id);
          await refresh();
        }}
        onCreateSession={async (workspaceId) => {
          setError(undefined);
          try {
            const session = await api.createSession(workspaceId);
            await refresh();
            update((l) => openInFocusedPane(l, session.id));
            setDrawerOpen(false);
          } catch (failure) {
            if (!(failure instanceof ApiError)) throw failure;
            setError(failure.message);
            await refresh();
          }
        }}
        onRenameSession={async (sessionId, name) => {
          await api.renameSession(sessionId, name);
          await refresh();
        }}
        onDeleteSession={async (sessionId) => {
          await api.deleteSession(sessionId);
          await refresh();
        }}
        onRestartSession={async (sessionId) => {
          setError(undefined);
          try {
            await api.restartSession(sessionId);
          } catch (failure) {
            if (!(failure instanceof ApiError)) throw failure;
            setError(failure.message);
          }
          await refresh();
        }}
        error={error}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b px-2">
          {phone ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Menu"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon />
            </Button>
          ) : (
            <span />
          )}
          {!phone && (
            <Button
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
        <PaneArea
          layout={layout}
          sessions={sessions}
          notices={notices}
          emptyMessage={
            state?.workspaces.length === 0
              ? "Create a Workspace to get started."
              : "Select a Session."
          }
          onEnded={() => void refresh()}
          onFocus={(pane) => update((l) => focusPane(l, pane))}
          onResize={(ratio) => update((l) => setRatio(l, ratio))}
        />
        {phone && focusedSession(layout) && <ExtraKeys />}
      </main>
    </div>
  );
}
