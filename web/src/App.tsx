import { Columns2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { PaneArea } from "@/components/PaneArea";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "./api";
import {
  focusedSession,
  focusPane,
  forgetMissingSessions,
  moveFocus,
  openInFocusedPane,
  openInOtherPane,
  setRatio,
  togglePaneCount,
  useLayout,
} from "./layout";
import { useAppState } from "./useAppState";

/** The app shell: the sidebar beside the main view (one or two Panes). */
export function App() {
  const { state, refresh, reorderWorkspaces } = useAppState();
  const [layout, update] = useLayout();

  const [error, setError] = useState<string>();

  const sessions = state?.workspaces.flatMap((w) => w.sessions) ?? [];

  // A Session deleted elsewhere empties its Pane rather than reconnecting to nothing.
  useEffect(() => {
    if (!state) return;
    const existing = new Set(
      state.workspaces.flatMap((w) => w.sessions.map((s) => s.id)),
    );
    update((l) => forgetMissingSessions(l, existing));
  }, [state, update]);

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
      <Sidebar
        state={state}
        openId={focusedSession(layout) ?? undefined}
        onOpen={(id) => update((l) => openInFocusedPane(l, id))}
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
          const session = await api.createSession(workspaceId);
          await refresh();
          update((l) => openInFocusedPane(l, session.id));
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
        <div className="flex h-9 shrink-0 items-center justify-end border-b px-2">
          <Button
            variant={layout.paneCount === 2 ? "secondary" : "ghost"}
            size="sm"
            aria-label="Two panes"
            aria-pressed={layout.paneCount === 2}
            onClick={() => update(togglePaneCount)}
          >
            <Columns2Icon />
          </Button>
        </div>
        <PaneArea
          layout={layout}
          sessions={sessions}
          emptyMessage={
            state?.workspaces.length === 0
              ? "Create a Workspace to get started."
              : "Select a Session."
          }
          onEnded={() => void refresh()}
          onFocus={(pane) => update((l) => focusPane(l, pane))}
          onResize={(ratio) => update((l) => setRatio(l, ratio))}
        />
      </main>
    </div>
  );
}
