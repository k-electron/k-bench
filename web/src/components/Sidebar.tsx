import { FolderIcon, PlusIcon } from "lucide-react";
import type { AppState } from "@/api";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { SessionRow } from "./SessionRow";
import { Button } from "./ui/button";

interface SidebarProps {
  state: AppState | undefined;
  openId: string | undefined;
  onOpen: (sessionId: string) => void;
  onCreateWorkspace: (folder: string) => Promise<void>;
  onCreateSession: (workspaceId: string) => Promise<void>;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

/** The tree of Workspaces and their Sessions. */
export function Sidebar({
  state,
  openId,
  onOpen,
  onCreateWorkspace,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
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
                <li key={session.id}>
                  <SessionRow
                    session={session}
                    isOpen={session.id === openId}
                    onOpen={() => onOpen(session.id)}
                    onRename={(name) => onRenameSession(session.id, name)}
                    onDelete={() => onDeleteSession(session.id)}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
