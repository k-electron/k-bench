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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { WorkspaceTile } from "./WorkspaceTile";

// The expanded sidebar's tree: a Workspace's row, and the Open Workspace's Session rows.

/**
 * Where the tree is shown: beside the Panes on a desktop or tablet, where it can collapse
 * to a column of tiles, or in the phone's drawer, where it is always expanded and rows are
 * taller for touch.
 */
export type SidebarMode = "sidebar" | "drawer";

export type SessionAction = "rename" | "delete";

/**
 * The classes that stretch a row's main button over the whole row (which must be
 * `relative`), so a click anywhere on it opens the row. Other controls in the row sit
 * above it with `relative z-10`.
 */
const STRETCHED =
  "outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

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
    <li
      {...row}
      className={cn("rounded-lg", isOpen && "bg-accent/30 pb-1", isDragging && LIFTED)}
    >
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-md px-1",
          mode === "drawer" ? "h-10" : "h-8",
          !isOpen && "hover:bg-accent/60",
        )}
      >
        {/* A folded Workspace's tile carries its Sessions' Bells. */}
        <WorkspaceTile workspace={workspace} bell={!isOpen && hasBell(workspace)} />
        <h2
          className={cn("min-w-0 flex-1 text-sm", isOpen && "font-semibold")}
          title={workspace.folder}
        >
          {/* Opening it starts its Prime and Worker; opening the Open one brings back Prime with Worker. */}
          <button
            type="button"
            {...handle}
            onClick={onOpen}
            className={cn("block w-full truncate text-left", STRETCHED)}
          >
            {workspace.name}
          </button>
        </h2>
        {isOpen && (
          <div className="relative z-10 flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`New session in ${workspace.name}`}>
                  <PlusIcon className="size-4" />
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
                  <MoreHorizontalIcon className="size-4" />
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
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onAction("delete")}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {isOpen && (
        <div className="ml-6 pr-0.5">
          {workspace.missing && (
            <div
              role="note"
              className="mx-1 mb-1 flex items-start gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <p>
                Missing: its folder is gone, so Sessions can't start. Running ones carry
                on.{" "}
                <button
                  type="button"
                  onClick={() => onAction("folder")}
                  className="font-medium underline underline-offset-2"
                >
                  Change folder
                </button>
              </p>
            </div>
          )}
          {children}
        </div>
      )}
    </li>
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
    <ul className="grid gap-0.5">
      {prime && <SessionItem key={prime.id} {...props(prime)} />}
      {worker && <SessionItem key={worker.id} {...props(worker)} />}
      {others.length > 0 && <li aria-hidden="true" className="mx-2 my-1 border-t" />}
      <Reorderable ids={others.map((s) => s.id)} onReorder={onReorder}>
        {others.map((session) => (
          <SortableSessionItem key={session.id} {...props(session)} />
        ))}
      </Reorderable>
    </ul>
  );
}

/** An Other Session's row, which reorders by dragging it. */
function SortableSessionItem(props: Omit<ComponentProps<typeof SessionItem>, "drag">) {
  return <SessionItem {...props} drag={useSortableRow(props.session.id)} />;
}

/**
 * One Session: its icon and name, "stopped" when it is, its Bell, and a ⋯ menu. The Prime
 * and Worker can't be renamed or deleted, so theirs appears only when Stopped, to restart.
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
  return (
    <li
      {...drag?.row}
      className={cn(
        "relative flex items-center gap-2 rounded-md px-2 text-sm",
        mode === "drawer" ? "h-8" : "h-7",
        isShown ? "bg-accent text-foreground" : "hover:bg-accent/60",
        stopped && "text-muted-foreground",
        drag?.isDragging && LIFTED,
      )}
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
      <button
        type="button"
        {...drag?.handle}
        aria-current={isShown ? "true" : undefined}
        onClick={onOpen}
        className={cn("min-w-0 truncate text-left", STRETCHED)}
      >
        {session.name}
      </button>
      {stopped && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide">stopped</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {session.bell && (
          <span role="img" aria-label={`${session.name} rang the bell`} className="flex">
            <BellIcon className="size-3.5 fill-current text-amber-400" />
          </span>
        )}
        {(!fixed || stopped) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={`Actions for ${session.name}`}
                className="relative z-10 -mr-1.5 size-6"
              >
                <MoreHorizontalIcon className="size-4" />
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
    </li>
  );
}
