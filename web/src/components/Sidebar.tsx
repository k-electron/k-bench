import { EllipsisIcon, FolderIcon, PlusIcon, TerminalIcon } from "lucide-react";
import type { AppState } from "@/api";
import { cn } from "@/lib/utils";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface SidebarProps {
  state: AppState | undefined;
  /** The Session in the Focused Pane. */
  openId: string | undefined;
  onOpen: (sessionId: string) => void;
  onOpenInOtherPane: (sessionId: string) => void;
  onCreateWorkspace: (folder: string) => Promise<void>;
  onCreateSession: (workspaceId: string) => Promise<void>;
}

/** The tree of Workspaces and their Sessions. */
export function Sidebar({
  state,
  openId,
  onOpen,
  onOpenInOtherPane,
  onCreateWorkspace,
  onCreateSession,
}: SidebarProps) {
  return (
    <nav
      aria-label="Workspaces"
      className="flex w-64 shrink-0 flex-col gap-2 border-r bg-card p-2"
    >
      <NewWorkspaceDialog onCreate={onCreateWorkspace} />
      <ul className="flex flex-col gap-3 overflow-y-auto">
        {state?.workspaces.map((workspace) => (
          <li key={workspace.id}>
            <div className="flex items-center gap-1 px-2 py-1 text-sm font-medium">
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={workspace.folder}>
                {workspace.name}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`New session in ${workspace.name}`}
                onClick={() => void onCreateSession(workspace.id)}
              >
                <PlusIcon />
              </Button>
            </div>
            <ul>
              {workspace.sessions.map((session) => (
                <li key={session.id} className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "min-w-0 flex-1 justify-start pl-6 font-normal",
                      session.id === openId && "bg-accent",
                      session.status === "stopped" && "text-muted-foreground",
                    )}
                    aria-current={session.id === openId ? "true" : undefined}
                    onClick={(event) =>
                      // ⌘-click opens it in the other Pane.
                      event.metaKey ? onOpenInOtherPane(session.id) : onOpen(session.id)
                    }
                  >
                    <TerminalIcon />
                    {session.name}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Menu for ${session.name}`}
                      >
                        <EllipsisIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => onOpenInOtherPane(session.id)}>
                        Open in other pane
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
