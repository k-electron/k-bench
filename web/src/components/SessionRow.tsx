import {
  Columns2Icon as ColumnsIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type { SessionState } from "@/api";
import { cn } from "@/lib/utils";
import { BellBadge } from "./BellBadge";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface SessionRowProps {
  session: SessionState;
  isOpen: boolean;
  onOpen: () => void;
  onOpenInOtherPane: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestart: () => Promise<void>;
}

/**
 * One Session in the sidebar: the row to open it, plus its row menu. To add a menu action,
 * add a `DropdownMenuItem` below (and any dialog it needs beside the existing ones).
 */
export function SessionRow({
  session,
  isOpen,
  onOpen,
  onOpenInOtherPane,
  onRename,
  onDelete,
  onRestart,
}: SessionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="group flex items-center">
      <span
        role="img"
        aria-label={`${session.name} ${session.status}`}
        className={cn(
          "ml-4 size-2 shrink-0 rounded-full",
          session.status === "running"
            ? "bg-emerald-500"
            : "border border-muted-foreground",
        )}
      />
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "min-w-0 flex-1 justify-start font-normal",
          isOpen && "bg-accent",
          session.status === "stopped" && "text-muted-foreground",
        )}
        aria-current={isOpen ? "true" : undefined}
        // ⌘-click opens it in the other Pane.
        onClick={(event) => (event.metaKey ? onOpenInOtherPane() : onOpen())}
      >
        <TerminalIcon />
        <span className="truncate">{session.name}</span>
      </Button>
      {session.bell && <BellBadge label={`${session.name} rang the bell`} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`Actions for ${session.name}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpenInOtherPane}>
            <ColumnsIcon />
            Open in other pane
          </DropdownMenuItem>
          {session.status === "stopped" && (
            <DropdownMenuItem onSelect={() => void onRestart()}>
              <RotateCcwIcon />
              Restart
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameSessionDialog
        open={renaming}
        onOpenChange={setRenaming}
        currentName={session.name}
        onRename={onRename}
      />
      <DeleteSessionDialog
        open={deleting}
        onOpenChange={setDeleting}
        sessionName={session.name}
        onDelete={onDelete}
      />
    </div>
  );
}
