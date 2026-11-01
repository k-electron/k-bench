import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderIcon, GripVerticalIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceState } from "@/api";
import { cn } from "@/lib/utils";
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
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate" title={workspace.folder}>
          {workspace.name}
        </h2>
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
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("folder")}>
              Change folder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("delete")}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </li>
  );
}
