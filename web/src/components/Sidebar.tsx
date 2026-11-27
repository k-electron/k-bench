import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Actions, useActions } from "@/useAppState";
import type { LaunchOptions } from "../../../src/shared/launch-options.ts";
import type { SessionState, State } from "../../../src/shared/state-protocol.ts";
import { IconButton } from "./IconButton";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { Reorderable } from "./Reorderable";
import { useSidebarDialogs } from "./SidebarDialogs";
import { WorkspaceTiles } from "./SidebarTiles";
import { SessionList, type SidebarMode, WorkspaceItem } from "./SidebarTree";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Sidebar as ShadSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarSeparator,
  useSidebar,
} from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface SidebarProps {
  state: State | undefined;
  /** The Sessions on screen, highlighted. */
  shown: ReadonlySet<string>;
  /** A Session row of the Open Workspace was chosen. */
  onOpenSession: (workspaceId: string, session: SessionState) => void;
  /** A Workspace's name was chosen. */
  onOpenWorkspace: (workspaceId: string) => void;
  /**
   * Creates a Workspace. When its folder already has one, opens that one as choosing its
   * name does, and says so in `error`.
   */
  onCreateWorkspace: (input: Parameters<Actions["createWorkspace"]>[0]) => Promise<void>;
  /** Creates a Session and opens it. */
  onCreateSession: (workspaceId: string) => Promise<void>;
  /** Launches a Claude Session and opens it; rejects with the server's refusal. */
  onCreateClaudeSession: (
    workspaceId: string,
    input: { name: string; claude: LaunchOptions },
  ) => Promise<void>;
  /**
   * Why the last Session create or restart, or Workspace open, was refused, or that a new
   * Workspace's folder already had one.
   */
  error?: string;
}

/**
 * The sidebar, on shadcn's `Sidebar`: every Workspace in the owner's order, each with its
 * letter tile, and only the Open Workspace unfolded into its Prime, Worker and Other
 * Sessions. Only the Open Workspace's row has the new-Session and Workspace menus. Beside
 * the Panes it collapses to a column of tiles (`collapsible="icon"`), remembered on this
 * Device by the caller; on a phone it is the Sidebar's own drawer, always expanded. Opening
 * a Workspace or a Session, and creating one (which can open one), is up to the caller;
 * every other action comes from `useActions`.
 */
export function Sidebar({
  state,
  shown,
  onOpenSession,
  onOpenWorkspace,
  onCreateWorkspace,
  onCreateSession,
  onCreateClaudeSession,
  error,
}: SidebarProps) {
  const actions = useActions();
  const workspaces = state?.workspaces ?? [];
  const { newClaude, editWorkspace, editSession, dialogs } = useSidebarDialogs({
    workspaces,
    onCreateClaudeSession,
  });
  const sidebar = useSidebar();
  const mode: SidebarMode = sidebar.isMobile ? "drawer" : "sidebar";
  const collapsed = !sidebar.isMobile && sidebar.state === "collapsed";
  const newWorkspace = (trigger: ReactNode) => (
    <NewWorkspaceDialog
      workspaces={workspaces}
      onCreate={onCreateWorkspace}
      trigger={trigger}
    />
  );

  const collapsedColumn = (
    <>
      <SidebarHeader className="items-center">
        <IconButton label="Expand sidebar" onClick={() => sidebar.setOpen(true)}>
          <PanelLeftOpenIcon />
        </IconButton>
      </SidebarHeader>
      <SidebarSeparator className="mx-auto w-8" />
      <SidebarContent>
        <WorkspaceTiles
          workspaces={workspaces}
          onReorder={actions.reorderWorkspaces}
          openWorkspaceId={state?.openWorkspaceId}
          shown={shown}
          onOpenWorkspace={onOpenWorkspace}
          onOpenSession={onOpenSession}
        />
      </SidebarContent>
      <SidebarFooter className="items-center">
        {newWorkspace(
          <IconButton
            label="New Workspace"
            className="size-8 rounded-lg border border-dashed border-sidebar-border"
          >
            <PlusIcon />
          </IconButton>,
        )}
        {error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span role="alert" aria-label={error} className="flex p-1">
                <TriangleAlertIcon className="size-4 text-destructive" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{error}</TooltipContent>
          </Tooltip>
        )}
      </SidebarFooter>
    </>
  );

  const tree = (
    <>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="gap-0.5 pr-0">
            <span className="flex-1">Workspaces</span>
            {newWorkspace(
              <IconButton label="New Workspace">
                <PlusIcon />
              </IconButton>,
            )}
            {mode === "sidebar" && (
              <IconButton label="Collapse sidebar" onClick={() => sidebar.setOpen(false)}>
                <PanelLeftCloseIcon />
              </IconButton>
            )}
          </SidebarGroupLabel>
          <Reorderable
            ids={workspaces.map((w) => w.id)}
            onReorder={actions.reorderWorkspaces}
          >
            <SidebarMenu>
              {workspaces.map((workspace) => {
                const isOpen = workspace.id === state?.openWorkspaceId;
                return (
                  <WorkspaceItem
                    key={workspace.id}
                    workspace={workspace}
                    isOpen={isOpen}
                    mode={mode}
                    onOpen={() => onOpenWorkspace(workspace.id)}
                    onNewShell={() => void onCreateSession(workspace.id)}
                    onNewClaude={() => newClaude(workspace)}
                    onAction={(action) => editWorkspace(workspace, action)}
                  >
                    <SessionList
                      workspace={workspace}
                      shown={shown}
                      mode={mode}
                      onOpen={(session) => onOpenSession(workspace.id, session)}
                      onAction={editSession}
                      onReorder={(ids) => actions.reorderSessions(workspace.id, ids)}
                    />
                  </WorkspaceItem>
                );
              })}
            </SidebarMenu>
          </Reorderable>
        </SidebarGroup>
      </SidebarContent>
      {error && (
        <SidebarFooter>
          <Alert variant="destructive" className="px-3 py-2">
            <TriangleAlertIcon />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        </SidebarFooter>
      )}
    </>
  );

  return (
    <>
      <ShadSidebar collapsible="icon">
        <nav aria-label="Workspaces" className="flex min-h-0 flex-1 flex-col">
          {collapsed ? collapsedColumn : tree}
        </nav>
      </ShadSidebar>
      {/* Outside the Sidebar, so closing the phone's drawer doesn't close them. */}
      {dialogs}
    </>
  );
}
