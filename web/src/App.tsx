import { MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ExtraKeys } from "@/components/ExtraKeys";
import { PhonePane, PhonePaneLabel } from "@/components/PhonePane";
import { Sidebar } from "@/components/Sidebar";
import { TypingKeys } from "@/components/TypingKeys";
import { Button } from "@/components/ui/button";
import { WorkspaceView } from "@/components/WorkspaceView";
import { cn } from "@/lib/utils";
import { ActionsProvider, useAppState } from "./useAppState";
import { useIsPhone } from "./useIsPhone";
import { useKeyboardUp } from "./useKeyboardUp";
import { usePhonePane } from "./usePhonePane";
import { useWorkspaceView } from "./workspaceView";

/**
 * The app shell. On a desktop or tablet, the sidebar beside the Open Workspace's two Panes.
 * On a phone, one Pane filling the screen, the sidebar in a slide-out drawer, and the
 * extra keys.
 */
export function App() {
  const { state, actions, error } = useAppState();
  const phone = useIsPhone();
  // With the on-screen keyboard up the app fits the space above it, minus the header and
  // the Extra keys row, which a compact overlay on the terminal replaces.
  const keyboardUp = useKeyboardUp(phone);
  // Both run whatever the size, so resizing the window keeps each one's state.
  const view = useWorkspaceView(state, actions);
  const phonePane = usePhonePane(state);
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

  /** Shows a new Other Session, once it is in state. */
  const openCreated = (workspaceId: string, id: string | undefined) => {
    if (id === undefined) return;
    if (phone) phonePane.open(id);
    else view.openOtherSession(workspaceId, id);
    setDrawerOpen(false);
  };
  const phoneSessionId = phonePane.sessionId;

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
          mode={phone ? "drawer" : "sidebar"}
          state={state}
          shown={phone ? new Set(phoneSessionId ? [phoneSessionId] : []) : view.shown}
          onOpenSession={(workspaceId, session) => {
            if (phone) phonePane.open(session.id);
            else view.chooseSession(workspaceId, session);
            setDrawerOpen(false);
          }}
          onOpenWorkspace={(workspaceId) =>
            phone
              ? void actions.openWorkspace(workspaceId)
              : view.openWorkspace(workspaceId)
          }
          onCreateSession={async (workspaceId) => {
            openCreated(workspaceId, await actions.createSession(workspaceId));
          }}
          onCreateClaudeSession={async (workspaceId, input) => {
            // A refusal rejects, so the dialog can show it; it stays open.
            openCreated(
              workspaceId,
              await actions.createClaudeSession(workspaceId, input),
            );
          }}
          error={error}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {!keyboardUp && (
            <div className="flex h-9 shrink-0 items-center border-b">
              {phone ? (
                <>
                  <Button
                    className="ml-2"
                    variant="ghost"
                    size="sm"
                    aria-label="Menu"
                    onClick={() => setDrawerOpen(true)}
                  >
                    <MenuIcon />
                  </Button>
                  <PhonePaneLabel content={phonePane.content} />
                </>
              ) : (
                view.workspace && (
                  <h1
                    className="min-w-0 truncate px-3 text-sm font-medium"
                    title={view.workspace.folder}
                  >
                    {view.workspace.name}
                  </h1>
                )
              )}
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {phone ? (
              <PhonePane
                content={phonePane.content}
                emptyMessage={
                  state?.workspaces.length === 0
                    ? "Create a Workspace to get started."
                    : "Select a Session."
                }
              />
            ) : (
              state && <WorkspaceView view={view} workspaces={state.workspaces} />
            )}
            {keyboardUp && phoneSessionId && <TypingKeys />}
          </div>
          {phone && !keyboardUp && phoneSessionId && (
            <ExtraKeys sessionId={phoneSessionId} />
          )}
        </main>
      </div>
    </ActionsProvider>
  );
}
