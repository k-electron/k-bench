import { type ReactNode, useState } from "react";
import { useActions } from "@/useAppState";
import type { LaunchOptions } from "../../../src/shared/launch-options.ts";
import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { EditWorkspaceDialog, type WorkspaceEdit } from "./EditWorkspaceDialog";
import { NewClaudeDialog } from "./NewClaudeDialog";
import { RenameSessionDialog } from "./RenameSessionDialog";
import type { SessionAction } from "./SidebarTree";

/**
 * The dialogs the sidebar's menus open: New Claude…, a Workspace's Rename, Change folder and
 * Delete, and a Session's Rename and Delete. `dialogs` is whichever is open, to render.
 */
export function useSidebarDialogs({
  workspaces,
  onCreateClaudeSession,
}: {
  workspaces: WorkspaceState[];
  /** Launches a Claude Session and opens it; rejects with the server's refusal. */
  onCreateClaudeSession: (
    workspaceId: string,
    input: { name: string; claude: LaunchOptions },
  ) => Promise<void>;
}): {
  newClaude: (workspace: WorkspaceState) => void;
  editWorkspace: (workspace: WorkspaceState, action: WorkspaceEdit | "delete") => void;
  editSession: (session: SessionState, action: SessionAction) => void;
  dialogs: ReactNode;
} {
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

  return {
    newClaude: setLaunching,
    editWorkspace: (workspace, action) => setDialog({ workspace, action }),
    editSession: (session, action) => setSessionDialog({ session, action }),
    dialogs: (
      <>
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
      </>
    ),
  };
}
