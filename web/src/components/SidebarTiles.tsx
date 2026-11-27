import { cn } from "@/lib/utils";
import { workspaceMarker } from "@/workspaces";
import { sessionsByRole } from "../../../src/shared/session-roles.ts";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { LIFTED, Reorderable, useSortableRow } from "./Reorderable";
import { SessionIcon } from "./SessionIcon";
import { SessionMarker } from "./SessionMarker";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { WorkspaceTile } from "./WorkspaceTile";

/**
 * The collapsed sidebar's column: a tile per Workspace, which opens it, and under the Open
 * Workspace's tile its Sessions as small icons, which open them. Each is named in a tooltip.
 */
export function WorkspaceTiles({
  workspaces,
  onReorder,
  openWorkspaceId,
  shown,
  onOpenWorkspace,
  onOpenSession,
}: {
  workspaces: WorkspaceState[];
  /** Every Workspace's id, in the order a tile was dragged into. */
  onReorder: (ids: string[]) => Promise<void>;
  openWorkspaceId: string | null | undefined;
  shown: ReadonlySet<string>;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (workspaceId: string, session: SessionState) => void;
}) {
  return (
    <Reorderable ids={workspaces.map((w) => w.id)} onReorder={onReorder}>
      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1">
        {workspaces.map((workspace) => (
          <WorkspaceTileItem
            key={workspace.id}
            workspace={workspace}
            isOpen={workspace.id === openWorkspaceId}
            shown={shown}
            onOpen={() => onOpenWorkspace(workspace.id)}
            onOpenSession={(session) => onOpenSession(workspace.id, session)}
          />
        ))}
      </ul>
    </Reorderable>
  );
}

/**
 * One Workspace in the collapsed sidebar: its tile, which opens it and is what a drag picks
 * up, and, for the Open Workspace, its Sessions as small icons under it.
 */
function WorkspaceTileItem({
  workspace,
  isOpen,
  shown,
  onOpen,
  onOpenSession,
}: {
  workspace: WorkspaceState;
  isOpen: boolean;
  shown: ReadonlySet<string>;
  onOpen: () => void;
  onOpenSession: (session: SessionState) => void;
}) {
  const { row, handle, isDragging } = useSortableRow(workspace.id);
  const { primeAndWorker, others } = sessionsByRole(workspace.sessions);
  const sessions = [...primeAndWorker, ...others];
  return (
    <li
      {...row}
      className={cn("flex flex-col items-center gap-1 rounded-lg", isDragging && LIFTED)}
    >
      {/* The button lies over the tile, so the tile's dot and Missing mark stay labelled. It
          is a plain, see-through button: shadcn's Button brings sizes and colours of its own,
          which an overlay doesn't want. */}
      <div className="relative">
        <WorkspaceTile
          workspace={workspace}
          size="md"
          marker={isOpen ? null : workspaceMarker(workspace)}
          className={cn(
            "rounded-lg",
            isOpen && "ring-2 ring-primary ring-offset-2 ring-offset-sidebar",
          )}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              {...handle}
              aria-label={workspace.name}
              aria-current={isOpen ? "true" : undefined}
              onClick={onOpen}
              className="absolute inset-0 rounded-lg outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="font-medium">{workspace.name}</div>
            <div className="opacity-70">{workspace.folder}</div>
          </TooltipContent>
        </Tooltip>
      </div>
      {isOpen && sessions.length > 0 && (
        <ul className="flex flex-col items-center gap-0.5 rounded-lg bg-sidebar-accent/40 p-0.5">
          {sessions.map((session) => (
            <SessionIconItem
              key={session.id}
              session={session}
              isShown={shown.has(session.id)}
              onOpen={() => onOpenSession(session)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One Session in the collapsed sidebar: its icon, dimmed when Stopped, and its marker. */
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
        isShown
          ? "bg-sidebar-accent shadow-[inset_0_-2px_0_var(--primary)]"
          : "hover:bg-sidebar-accent/60",
      )}
    >
      <SessionIcon session={session} className={cn("size-4", stopped && "opacity-50")} />
      {/* A plain, see-through button over the icon, as on the Workspace's tile above. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={session.name}
            aria-current={isShown ? "true" : undefined}
            onClick={onOpen}
            className="absolute inset-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </TooltipTrigger>
        <TooltipContent side="right">
          {stopped ? `${session.name} (stopped)` : session.name}
        </TooltipContent>
      </Tooltip>
      {stopped && <span className="sr-only">stopped</span>}
      <SessionMarker
        session={session}
        className="pointer-events-none absolute -top-0.5 -right-0.5 scale-75"
      />
    </li>
  );
}
