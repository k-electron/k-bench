import { Columns2Icon, MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ExtraKeys } from "@/components/ExtraKeys";
import { PaneArea } from "@/components/PaneArea";
import { PaneLabels } from "@/components/PaneLabels";
import { Sidebar } from "@/components/Sidebar";
import { TypingKeys } from "@/components/TypingKeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionsProvider, useAppState } from "./useAppState";
import { useIsPhone } from "./useIsPhone";
import { useKeyboardUp } from "./useKeyboardUp";
import { usePaneView } from "./usePaneView";

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
  const panes = usePaneView(state, phone);
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
          openId={panes.focusedSessionId}
          onOpen={(id) => {
            panes.openInFocusedPane(id);
            setDrawerOpen(false);
          }}
          onOpenInOtherPane={panes.openInOtherPane}
          onCreateSession={async (workspaceId) => {
            // Resolves once the new Session is in state, so the Pane knows it.
            const id = await actions.createSession(workspaceId);
            if (id === undefined) return;
            panes.openInFocusedPane(id);
            setDrawerOpen(false);
          }}
          onCreateClaudeSession={async (workspaceId, input) => {
            // A refusal rejects, so the dialog can show it; it stays open.
            const id = await actions.createClaudeSession(workspaceId, input);
            if (id === undefined) return;
            panes.openInFocusedPane(id);
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
                panes={panes.panes}
                paneCount={panes.paneCount}
                ratio={panes.ratio}
                className={phone ? "flex-1" : "absolute inset-0"}
              />
              {!phone && (
                <Button
                  className="relative mr-2 ml-auto"
                  variant={panes.paneCount === 2 ? "secondary" : "ghost"}
                  size="sm"
                  aria-label="Two panes"
                  aria-pressed={panes.paneCount === 2}
                  onClick={panes.togglePaneCount}
                >
                  <Columns2Icon />
                </Button>
              )}
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <PaneArea
              panes={panes.panes}
              paneCount={panes.paneCount}
              ratio={panes.ratio}
              emptyMessage={
                state?.workspaces.length === 0
                  ? "Create a Workspace to get started."
                  : "Select a Session."
              }
              onFocus={panes.focusPane}
              onResize={panes.setRatio}
            />
            {keyboardUp && panes.focusedSessionId && <TypingKeys />}
          </div>
          {phone && !keyboardUp && panes.focusedSessionId && (
            <ExtraKeys sessionId={panes.focusedSessionId} />
          )}
        </main>
      </div>
    </ActionsProvider>
  );
}
