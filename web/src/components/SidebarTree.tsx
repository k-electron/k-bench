import {
  BellIcon,
  FolderInputIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useActions } from "@/useAppState";
import { hasBell } from "@/workspaces";
import { sessionsByRole } from "../../../src/shared/session-roles.ts";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { WorkspaceEdit } from "./EditWorkspaceDialog";
import { IconButton } from "./IconButton";
import { LIFTED, Reorderable, type SortableRow, useSortableRow } from "./Reorderable";
import { SessionIcon } from "./SessionIcon";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Separator } from "./ui/separator";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";
import { WorkspaceTile } from "./WorkspaceTile";

// The expanded sidebar's tree: a Workspace's row, and the Open Workspace's Session rows.
// A row's button is named explicitly, so what else sits inside it never joins its name.

/**
 * Where the tree is shown: beside the Panes on a desktop or tablet, where it can collapse
 * to a column of tiles, or in the phone's drawer, where it is always expanded and rows are
 * taller for touch.
 */
export type SidebarMode = "sidebar" | "drawer";

export type SessionAction = "rename" | "delete";

/**
 * One Workspace: its tile and name, which opens it and is what a drag picks up, and, for
 * the Open Workspace only, its ＋ and ⋯ menus and its Sessions (`children`) underneath.
 */
export function WorkspaceItem({
  workspace,
  isOpen,
  mode,
  onOpen,
  onNewShell,
  onNewClaude,
  onAction,
  children,
}: {
  workspace: WorkspaceState;
  isOpen: boolean;
  mode: SidebarMode;
  onOpen: () => void;
  onNewShell: () => void;
  /** New Claude…, which asks for its details first. */
  onNewClaude: () => void;
  onAction: (action: WorkspaceEdit | "delete") => void;
  children: ReactNode;
}) {
  const { row, handle, isDragging } = useSortableRow(workspace.id);

  return (
    <SidebarMenuItem {...row} className={cn("rounded-md", isDragging && LIFTED)}>
      <h2 className="text-sm font-normal" title={workspace.folder}>
        {/* Opening it starts its Prime and Worker; opening the Open one brings back Prime with Worker. */}
        <SidebarMenuButton
          {...handle}
          aria-label={workspace.name}
          onClick={onOpen}
          className={cn(mode === "drawer" && "h-10", isOpen && "pr-16 font-semibold")}
        >
          {/* A folded Workspace's tile carries its Sessions' Bells. */}
          <WorkspaceTile workspace={workspace} bell={!isOpen && hasBell(workspace)} />
          <span>{workspace.name}</span>
        </SidebarMenuButton>
      </h2>
      {isOpen && (
        <div
          className={cn(
            "absolute right-1 flex items-center",
            mode === "drawer" ? "top-2" : "top-0.5",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`New session in ${workspace.name}`}>
                <PlusIcon />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onNewShell}>
                <TerminalIcon />
                New shell
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewClaude}>
                <SparklesIcon />
                New Claude…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${workspace.name}`}>
                <MoreHorizontalIcon />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAction("rename")}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("folder")}>
                <FolderInputIcon />
                Change folder
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {isOpen && workspace.missing && (
        // A note, not an alert: it describes the Workspace rather than announcing a change.
        <Alert variant="destructive" role="note" className="mx-1 mt-1 w-auto px-3 py-2">
          <TriangleAlertIcon />
          <AlertDescription className="text-xs">
            <p>
              Missing: its folder is gone, so Sessions can't start. Running ones carry on.{" "}
              <button
                type="button"
                onClick={() => onAction("folder")}
                className="font-medium underline underline-offset-2"
              >
                Change folder
              </button>
            </p>
          </AlertDescription>
        </Alert>
      )}
      {isOpen && children}
    </SidebarMenuItem>
  );
}

/** The Open Workspace's Sessions: Prime, Worker, a divider, then its Other Sessions. */
export function SessionList({
  workspace,
  shown,
  mode,
  onOpen,
  onAction,
  onReorder,
}: {
  workspace: WorkspaceState;
  shown: ReadonlySet<string>;
  mode: SidebarMode;
  onOpen: (session: SessionState) => void;
  onAction: (session: SessionState, action: SessionAction) => void;
  /** Every Other Session's id, in the order one was dragged into. */
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const { prime, worker, others } = sessionsByRole(workspace.sessions);
  const props = (session: SessionState) => ({
    session,
    isShown: shown.has(session.id),
    mode,
    onOpen: () => onOpen(session),
    onAction: (action: SessionAction) => onAction(session, action),
  });
  // Only the Other Sessions reorder; the Prime and Worker sit above them, out of reach.
  return (
    <SidebarMenuSub className="mr-0 pr-0">
      {prime && <SessionItem key={prime.id} {...props(prime)} />}
      {worker && <SessionItem key={worker.id} {...props(worker)} />}
      {others.length > 0 && (
        <li aria-hidden="true" className="py-1">
          <Separator className="bg-sidebar-border" />
        </li>
      )}
      <Reorderable ids={others.map((s) => s.id)} onReorder={onReorder}>
        {others.map((session) => (
          <SortableSessionItem key={session.id} {...props(session)} />
        ))}
      </Reorderable>
    </SidebarMenuSub>
  );
}

/** An Other Session's row, which reorders by dragging it. */
function SortableSessionItem(props: Omit<ComponentProps<typeof SessionItem>, "drag">) {
  return <SessionItem {...props} drag={useSortableRow(props.session.id)} />;
}

/**
 * One Session: its icon and name, a "stopped" badge when it is, its Bell, and a ⋯ menu.
 * The Prime and Worker can't be renamed or deleted, so theirs appears only when Stopped, to
 * restart.
 */
function SessionItem({
  session,
  isShown,
  mode,
  onOpen,
  onAction,
  drag,
}: {
  session: SessionState;
  /** It is on screen, in a Pane. */
  isShown: boolean;
  mode: SidebarMode;
  onOpen: () => void;
  onAction: (action: SessionAction) => void;
  /** How an Other Session's row is dragged; the Prime and Worker have none. */
  drag?: SortableRow;
}) {
  const actions = useActions();
  const stopped = session.status === "stopped";
  const fixed = session.role !== null;
  const hasMenu = !fixed || stopped;
  return (
    <SidebarMenuSubItem
      {...drag?.row}
      className={cn("rounded-md", drag?.isDragging && LIFTED)}
    >
      <SidebarMenuSubButton
        asChild
        isActive={isShown}
        className={cn(
          "w-full",
          mode === "drawer" ? "h-9" : "h-7",
          hasMenu ? "pr-12" : "pr-7",
          stopped && "text-muted-foreground",
          "data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]",
        )}
      >
        <button
          type="button"
          {...drag?.handle}
          aria-label={session.name}
          aria-current={isShown ? "true" : undefined}
          onClick={onOpen}
        >
          <span
            role="img"
            aria-label={
              session.kind === "claude"
                ? `${session.name} is a Claude Session`
                : `${session.name} is a shell`
            }
            className={cn("flex", stopped && "opacity-50")}
          >
            <SessionIcon session={session} className="size-4" />
          </span>
          <span className="truncate">{session.name}</span>
          {stopped && (
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[10px] font-normal tracking-wide text-muted-foreground uppercase"
            >
              stopped
            </Badge>
          )}
        </button>
      </SidebarMenuSubButton>
      <span className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1">
        {session.bell && (
          <span role="img" aria-label={`${session.name} rang the bell`} className="flex">
            <BellIcon className="size-3.5 fill-current text-status-bell" />
          </span>
        )}
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={`Actions for ${session.name}`}
                className="pointer-events-auto size-6"
              >
                <MoreHorizontalIcon />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {stopped && (
                <DropdownMenuItem
                  onSelect={() => void actions.restartSession(session.id)}
                >
                  <RotateCcwIcon />
                  Restart
                </DropdownMenuItem>
              )}
              {!fixed && (
                <>
                  <DropdownMenuItem onSelect={() => onAction("rename")}>
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onAction("delete")}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </SidebarMenuSubItem>
  );
}
