import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderInputIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { WorkspaceState } from "@/api";
import { cn } from "@/lib/utils";
import { BellBadge } from "./BellBadge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type WorkspaceAction = "rename" | "folder" | "delete";

/**
 * One Workspace in the sidebar: a drag handle, its name, a row menu and the new-Session
 * button, with its Sessions (`children`) underneath. Sortable by its handle.
 */
export function WorkspaceRow({
  workspace,
  onCreateSession,
  onAction,
  children,
}: {
  workspace: WorkspaceState;
  onCreateSession: () => void;
  onAction: (action: WorkspaceAction) => void;
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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-md bg-card", isDragging && "relative z-10 shadow-lg")}
    >
      <div className="flex items-center gap-1 py-1 pr-1 text-sm font-medium">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${workspace.name}`}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <GripVerticalIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${workspace.name}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
        </button>
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate" title={workspace.folder}>
          {workspace.name}
        </h2>
        {/* Collapsed, the Sessions' own badges are out of sight: roll them up here. */}
        {collapsed && workspace.sessions.some((session) => session.bell) && (
          <BellBadge label={`${workspace.name} has a session that rang the bell`} />
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`New session in ${workspace.name}`}
          onClick={onCreateSession}
        >
          <PlusIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${workspace.name}`}
            >
              <MoreHorizontalIcon />
            </Button>
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
      {workspace.missing && (
        <p
          role="note"
          className="mx-2 mb-1 flex items-start gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Missing: its folder is gone from the Host, so Sessions can't start. Running
            Sessions carry on. Change the folder to fix it.
          </span>
        </p>
      )}
      {!collapsed && children}
    </li>
  );
}
