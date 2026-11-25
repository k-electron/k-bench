import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type Actions, useActions } from "@/useAppState";
import { useSidebarCollapsed } from "@/useSidebarCollapsed";
import type { LaunchOptions } from "../../../src/shared/launch-options.ts";
import type { SessionState, State } from "../../../src/shared/state-protocol.ts";
import { IconButton } from "./IconButton";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { Reorderable } from "./Reorderable";
import { useSidebarDialogs } from "./SidebarDialogs";
import { WorkspaceTiles } from "./SidebarTiles";
import { SessionList, type SidebarMode, WorkspaceItem } from "./SidebarTree";

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
  mode?: SidebarMode;
  /** Sizing and placement, which differ between the desktop sidebar and the phone drawer. */
  className?: string;
}

/**
 * The sidebar tree: every Workspace in the owner's order, each with its letter tile, and
 * only the Open Workspace unfolded into its Prime, Worker and Other Sessions. Only the Open
 * Workspace's row has the new-Session and Workspace menus. Beside the Panes it can collapse
 * to a column of tiles, remembered on this device. Opening a Workspace or a Session, and
 * creating one (which can open one), is up to the caller; every other action comes from
 * `useActions`.
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
  mode = "sidebar",
  className,
}: SidebarProps) {
  const actions = useActions();
  const workspaces = state?.workspaces ?? [];
  const { newClaude, editWorkspace, editSession, dialogs } = useSidebarDialogs({
    workspaces,
    onCreateClaudeSession,
  });
  const [collapsedHere, setCollapsed] = useSidebarCollapsed();
  // The phone's drawer is always the full tree.
  const collapsed = mode === "sidebar" && collapsedHere;
  const newWorkspace = (trigger: ReactNode) => (
    <NewWorkspaceDialog
      workspaces={workspaces}
      onCreate={onCreateWorkspace}
      trigger={trigger}
    />
  );

  if (collapsed) {
    return (
      <nav
        aria-label="Workspaces"
        // Narrower than whatever width the caller gives the expanded tree.
        className={cn(
          "flex shrink-0 flex-col items-center gap-2 border-r bg-card py-2",
          className,
          "w-14",
        )}
      >
        <IconButton label="Expand sidebar" onClick={() => setCollapsed(false)}>
          <PanelLeftOpenIcon className="size-4" />
        </IconButton>
        <div aria-hidden="true" className="w-8 border-t" />
        <WorkspaceTiles
          workspaces={workspaces}
          onReorder={actions.reorderWorkspaces}
          openWorkspaceId={state?.openWorkspaceId}
          shown={shown}
          onOpenWorkspace={onOpenWorkspace}
          onOpenSession={onOpenSession}
        />
        {newWorkspace(
          <button
            type="button"
            aria-label="New Workspace"
            title="New Workspace"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <PlusIcon className="size-4" />
          </button>,
        )}
        {error && (
          <span role="alert" aria-label={error} title={error} className="flex">
            <TriangleAlertIcon className="size-4 text-destructive" />
          </span>
        )}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Workspaces"
      className={cn("flex shrink-0 flex-col gap-1 border-r bg-card p-2", className)}
    >
      <div className="flex items-center gap-1 px-1 pb-1">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workspaces
        </span>
        {newWorkspace(
          <IconButton label="New Workspace">
            <PlusIcon className="size-4" />
          </IconButton>,
        )}
        {mode === "sidebar" && (
          <IconButton label="Collapse sidebar" onClick={() => setCollapsed(true)}>
            <PanelLeftCloseIcon className="size-4" />
          </IconButton>
        )}
      </div>
      <Reorderable
        ids={workspaces.map((w) => w.id)}
        onReorder={actions.reorderWorkspaces}
      >
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
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
        </ul>
      </Reorderable>
      {dialogs}
      {error && (
        <p role="alert" className="px-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </nav>
  );
}
