import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BellIcon,
  FolderInputIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { useActions } from "@/useAppState";
import { useSidebarCollapsed } from "@/useSidebarCollapsed";
import type { LaunchOptions } from "../../../src/shared/launch-options.ts";
import type {
  SessionState,
  State,
  WorkspaceState,
} from "../../../src/shared/state-protocol.ts";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { EditWorkspaceDialog, type WorkspaceEdit } from "./EditWorkspaceDialog";
import { NewClaudeDialog } from "./NewClaudeDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { SessionIcon } from "./SessionIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { hasBell, WorkspaceTile } from "./WorkspaceTile";

/**
 * Where the tree is shown: beside the Panes on a desktop or tablet, where it can collapse
 * to a column of tiles, or in the phone's drawer, where it is always expanded and rows are
 * taller for touch.
 */
export type SidebarMode = "sidebar" | "drawer";

interface SidebarProps {
  state: State | undefined;
  /** The Sessions on screen, highlighted. */
  shown: ReadonlySet<string>;
  /** A Session row of the Open Workspace was chosen. */
  onOpenSession: (workspaceId: string, session: SessionState) => void;
  /** A Workspace's name was chosen. */
  onOpenWorkspace: (workspaceId: string) => void;
  /** Creates a Session and opens it. */
  onCreateSession: (workspaceId: string) => Promise<void>;
  /** Launches a Claude Session and opens it; rejects with the server's refusal. */
  onCreateClaudeSession: (
    workspaceId: string,
    input: { name: string; claude: LaunchOptions },
  ) => Promise<void>;
  /** Why the last Session create or restart was refused, if it was. */
  error?: string;
  mode?: SidebarMode;
  /** Sizing and placement, which differ between the desktop sidebar and the phone drawer. */
  className?: string;
}

type SessionAction = "rename" | "delete";

/**
 * The sidebar tree: every Workspace in the owner's order, each with its letter tile, and
 * only the Open Workspace unfolded into its Prime, Worker and Other Sessions. Only the Open
 * Workspace's row has the new-Session and Workspace menus. Beside the Panes it can collapse
 * to a column of tiles, remembered on this device. Opening a Workspace or a Session is up
 * to the caller; every other action comes from `useActions`.
 */
export function Sidebar({
  state,
  shown,
  onOpenSession,
  onOpenWorkspace,
  onCreateSession,
  onCreateClaudeSession,
  error,
  mode = "sidebar",
  className,
}: SidebarProps) {
  const actions = useActions();
  const [launching, setLaunching] = useState<WorkspaceState>();
  const [dialog, setDialog] = useState<{
    workspace: WorkspaceState;
    action: WorkspaceEdit | "delete";
  }>();
  const [sessionDialog, setSessionDialog] = useState<{
    session: SessionState;
    action: SessionAction;
  }>();
  const [collapsedHere, setCollapsed] = useSidebarCollapsed();
  // The phone's drawer is always the full tree.
  const collapsed = mode === "sidebar" && collapsedHere;
  const workspaces = state?.workspaces ?? [];
  const newWorkspace = (trigger: ReactNode) => (
    <NewWorkspaceDialog
      workspaces={workspaces}
      onCreate={actions.createWorkspace}
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
      <SortableWorkspaces
        workspaces={workspaces}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
      >
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
              onNewClaude={() => setLaunching(workspace)}
              onAction={(action) => setDialog({ workspace, action })}
            >
              <SessionList
                workspace={workspace}
                shown={shown}
                mode={mode}
                onOpen={(session) => onOpenSession(workspace.id, session)}
                onAction={(session, action) => setSessionDialog({ session, action })}
              />
            </WorkspaceItem>
          );
        })}
      </SortableWorkspaces>
      {launching && (
        <NewClaudeDialog
          workspace={launching}
          onLaunch={(input) => onCreateClaudeSession(launching.id, input)}
          onClose={() => setLaunching(undefined)}
        />
      )}
      {dialog && dialog.action !== "delete" && (
        <EditWorkspaceDialog
          workspace={dialog.workspace}
          workspaces={workspaces}
          edit={dialog.action}
          onSave={(changes) => actions.updateWorkspace(dialog.workspace.id, changes)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.action === "delete" && (
        <DeleteWorkspaceDialog
          workspace={dialog.workspace}
          onDelete={() => actions.deleteWorkspace(dialog.workspace.id)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {sessionDialog?.action === "rename" && (
        <RenameSessionDialog
          key={sessionDialog.session.id}
          open
          onOpenChange={(open) => !open && setSessionDialog(undefined)}
          currentName={sessionDialog.session.name}
          onRename={(name) => actions.renameSession(sessionDialog.session.id, name)}
        />
      )}
      {sessionDialog?.action === "delete" && (
        <DeleteSessionDialog
          key={sessionDialog.session.id}
          open
          onOpenChange={(open) => !open && setSessionDialog(undefined)}
          sessionName={sessionDialog.session.name}
          onDelete={() => actions.deleteSession(sessionDialog.session.id)}
        />
      )}
      {error && (
        <p role="alert" className="px-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </nav>
  );
}

/** A small square button holding just an icon, named by `label`. */
function IconButton({
  label,
  className,
  children,
  ...rest
}: { label: string; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The classes that stretch a row's main button over the whole row (which must be
 * `relative`), so a click anywhere on it opens the row. Other controls in the row sit
 * above it with `relative z-10`.
 */
const STRETCHED =
  "outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

/** Workspaces reorder by dragging their row; a short click still opens it. */
function SortableWorkspaces({
  workspaces,
  className,
  children,
}: {
  workspaces: WorkspaceState[];
  className?: string;
  children: ReactNode;
}) {
  const actions = useActions();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // On a phone a drag starts with a short press, so scrolling the sidebar still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = workspaces.map((w) => w.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    ids.splice(to, 0, ...ids.splice(from, 1));
    void actions.reorderWorkspaces(ids);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={workspaces.map((w) => w.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={className}>{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

/**
 * One Workspace: its tile and name, which opens it and is what a drag picks up, and, for
 * the Open Workspace only, its ＋ and ⋯ menus and its Sessions (`children`) underneath.
 */
function WorkspaceItem({
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
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-lg",
        isOpen && "bg-accent/30 pb-1",
        isDragging && "relative z-20 bg-card shadow-lg",
      )}
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
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
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

/** A Workspace's Prime, Worker and Other Sessions. */
function sessionsByRole(workspace: WorkspaceState): {
  prime: SessionState | undefined;
  worker: SessionState | undefined;
  others: SessionState[];
} {
  return {
    prime: workspace.sessions.find((s) => s.role === "prime"),
    worker: workspace.sessions.find((s) => s.role === "worker"),
    others: workspace.sessions.filter((s) => s.role === null),
  };
}

/**
 * The collapsed sidebar's column: a tile per Workspace, which opens it, and under the Open
 * Workspace's tile its Sessions as small icons, which open them.
 */
function WorkspaceTiles({
  workspaces,
  openWorkspaceId,
  shown,
  onOpenWorkspace,
  onOpenSession,
}: {
  workspaces: WorkspaceState[];
  openWorkspaceId: string | null | undefined;
  shown: ReadonlySet<string>;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (workspaceId: string, session: SessionState) => void;
}) {
  return (
    <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1">
      {workspaces.map((workspace) => {
        const isOpen = workspace.id === openWorkspaceId;
        const { prime, worker, others } = sessionsByRole(workspace);
        const sessions = [prime, worker, ...others].filter(
          (s): s is SessionState => s !== undefined,
        );
        return (
          <li key={workspace.id} className="flex flex-col items-center gap-1">
            {/* The button lies over the tile, so the tile's Bell dot and Missing mark stay labelled. */}
            <div className="relative">
              <WorkspaceTile
                workspace={workspace}
                size="md"
                bell={!isOpen && hasBell(workspace)}
                className={cn("rounded-lg", isOpen && "ring-2 ring-foreground/80")}
              />
              <button
                type="button"
                aria-label={workspace.name}
                aria-current={isOpen ? "true" : undefined}
                title={`${workspace.name}\n${workspace.folder}`}
                onClick={() => onOpenWorkspace(workspace.id)}
                className="absolute inset-0 rounded-lg outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            {isOpen && sessions.length > 0 && (
              <ul className="flex flex-col items-center gap-0.5 rounded-lg bg-accent/40 p-0.5">
                {sessions.map((session) => (
                  <SessionIconItem
                    key={session.id}
                    session={session}
                    isShown={shown.has(session.id)}
                    onOpen={() => onOpenSession(workspace.id, session)}
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One Session in the collapsed sidebar: its icon, dimmed when Stopped, and its Bell dot. */
function SessionIconItem({
  session,
  isShown,
  onOpen,
}: {
  session: SessionState;
  /** It is on screen, in a Pane. */
  isShown: boolean;
  onOpen: () => void;
}) {
  const stopped = session.status === "stopped";
  return (
    <li
      className={cn(
        "relative grid size-7 place-items-center rounded-md",
        isShown ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <SessionIcon session={session} className={cn("size-4", stopped && "opacity-50")} />
      <button
        type="button"
        aria-label={session.name}
        aria-current={isShown ? "true" : undefined}
        title={stopped ? `${session.name} (stopped)` : session.name}
        onClick={onOpen}
        className="absolute inset-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {stopped && <span className="sr-only">stopped</span>}
      {session.bell && (
        <span
          role="img"
          aria-label={`${session.name} rang the bell`}
          className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-amber-400"
        />
      )}
    </li>
  );
}

/** The Open Workspace's Sessions: Prime, Worker, a divider, then its Other Sessions. */
function SessionList({
  workspace,
  shown,
  mode,
  onOpen,
  onAction,
}: {
  workspace: WorkspaceState;
  shown: ReadonlySet<string>;
  mode: SidebarMode;
  onOpen: (session: SessionState) => void;
  onAction: (session: SessionState, action: SessionAction) => void;
}) {
  const { prime, worker, others } = sessionsByRole(workspace);
  const item = (session: SessionState) => (
    <SessionItem
      key={session.id}
      session={session}
      isShown={shown.has(session.id)}
      mode={mode}
      onOpen={() => onOpen(session)}
      onAction={(action) => onAction(session, action)}
    />
  );
  return (
    <ul className="grid gap-0.5">
      {prime && item(prime)}
      {worker && item(worker)}
      {others.length > 0 && <li aria-hidden="true" className="mx-2 my-1 border-t" />}
      {others.map(item)}
    </ul>
  );
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
}: {
  session: SessionState;
  /** It is on screen, in a Pane. */
  isShown: boolean;
  mode: SidebarMode;
  onOpen: () => void;
  onAction: (action: SessionAction) => void;
}) {
  const actions = useActions();
  const stopped = session.status === "stopped";
  const fixed = session.role !== null;
  return (
    <li
      className={cn(
        "relative flex items-center gap-2 rounded-md px-2 text-sm",
        mode === "drawer" ? "h-8" : "h-7",
        isShown ? "bg-accent text-foreground" : "hover:bg-accent/60",
        stopped && "text-muted-foreground",
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
