import { ExtraKeys } from "@/components/ExtraKeys";
import { PhoneMenuButton, PhoneTitle, PhoneView } from "@/components/PhoneView";
import { Sidebar } from "@/components/Sidebar";
import { TypingKeys } from "@/components/TypingKeys";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { WorkspaceView } from "@/components/WorkspaceView";
import { cn } from "@/lib/utils";
import { usePhoneView } from "./phoneView";
import { ActionsProvider, useAppState } from "./useAppState";
import { useIsPhone } from "./useIsPhone";
import { useKeyboardUp } from "./useKeyboardUp";
import { useSidebarCollapsed } from "./useSidebarCollapsed";
import { useWorkspaceView } from "./workspaceView";

/**
 * The app, inside shadcn's `SidebarProvider`, which holds whether the sidebar is collapsed
 * (kept on this Device) and whether the phone's drawer is open.
 */
export function App() {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      className="h-full min-h-0"
    >
      <Shell />
    </SidebarProvider>
  );
}

/**
 * The app shell. On a desktop or tablet, the sidebar beside the Open Workspace's two Panes.
 * On a phone, one Session of the Open Workspace filling the screen, under a
 * `Workspace › Session` title, with the sidebar in the Sidebar's own drawer and the extra keys.
 */
function Shell() {
  const { state, actions, error } = useAppState();
  const phone = useIsPhone();
  // With the on-screen keyboard up the app fits the space above it, minus the header and
  // the Extra keys row, which a compact overlay on the terminal replaces.
  const keyboardUp = useKeyboardUp(phone);
  // Both run whatever the size, so resizing the window keeps each one's state.
  const view = useWorkspaceView(state, actions);
  const phoneView = usePhoneView(state, view);
  const { setOpenMobile } = useSidebar();
  const closeDrawer = () => setOpenMobile(false);

  /** Shows a new Other Session, once it is in state. */
  const openCreated = (workspaceId: string, id: string | undefined) => {
    if (id === undefined) return;
    if (phone) phoneView.show(workspaceId, id);
    else view.openOtherSession(workspaceId, id);
    closeDrawer();
  };
  /** Opens a Workspace as choosing its name does. */
  const openWorkspace = (workspaceId: string) => {
    if (phone) phoneView.openWorkspace(workspaceId);
    else view.openWorkspace(workspaceId);
  };
  const phoneSessionId = phoneView.session?.id;

  return (
    <ActionsProvider value={actions}>
      <Sidebar
        state={state}
        shown={phone ? new Set(phoneSessionId ? [phoneSessionId] : []) : view.shown}
        onOpenSession={(workspaceId, session) => {
          if (phone) phoneView.show(workspaceId, session.id);
          else view.chooseSession(workspaceId, session);
          closeDrawer();
        }}
        onOpenWorkspace={(workspaceId) => {
          openWorkspace(workspaceId);
          closeDrawer();
        }}
        // The drawer stays open, as after any create, so the owner sees why.
        onCreateWorkspace={(input) => actions.createWorkspace(input, openWorkspace)}
        onCreateSession={async (workspaceId) => {
          openCreated(workspaceId, await actions.createSession(workspaceId));
        }}
        onCreateClaudeSession={async (workspaceId, input) => {
          // A refusal rejects, so the dialog can show it; it stays open.
          openCreated(workspaceId, await actions.createClaudeSession(workspaceId, input));
        }}
        error={error}
      />
      <SidebarInset
        className={cn(
          "min-w-0",
          keyboardUp && "fixed inset-x-0 top-(--app-top) h-(--app-height)",
        )}
      >
        {!keyboardUp && (
          <div className="flex h-9 shrink-0 items-center border-b">
            {phone ? (
              <>
                <PhoneMenuButton view={phoneView} onOpen={() => setOpenMobile(true)} />
                <PhoneTitle view={phoneView} />
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
          {state &&
            (phone ? (
              <PhoneView view={phoneView} workspaces={state.workspaces} />
            ) : (
              <WorkspaceView view={view} workspaces={state.workspaces} />
            ))}
          {keyboardUp && phoneSessionId && <TypingKeys />}
        </div>
        {phone && !keyboardUp && phoneSessionId && (
          <ExtraKeys sessionId={phoneSessionId} />
        )}
      </SidebarInset>
    </ActionsProvider>
  );
}
