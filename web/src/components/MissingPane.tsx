import { FolderInputIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { useActions } from "@/useAppState";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { TERMINAL_BACKGROUND } from "../terminalLook";
import { EditWorkspaceDialog } from "./EditWorkspaceDialog";
import { PaneNotice } from "./Pane";
import { Button } from "./ui/button";

/**
 * What a Pane shows for a Stopped Session of a Missing Workspace, which can't start until
 * the folder is fixed: the notice, and Change folder to fix it from here.
 */
export function MissingPane({
  workspace,
  workspaces,
}: {
  workspace: WorkspaceState;
  /** Every Workspace, for the folder picker. */
  workspaces: WorkspaceState[];
}) {
  const actions = useActions();
  const [changing, setChanging] = useState(false);
  return (
    <section
      aria-label="Missing folder"
      className="h-full min-h-0 p-2"
      style={{ backgroundColor: TERMINAL_BACKGROUND }}
    >
      <PaneNotice>
        <p className="flex items-center gap-1.5 text-destructive">
          <TriangleAlertIcon className="size-4 shrink-0" />
          This Workspace's folder is missing
        </p>
        <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
          <FolderInputIcon />
          Change folder
        </Button>
      </PaneNotice>
      {changing && (
        <EditWorkspaceDialog
          workspace={workspace}
          workspaces={workspaces}
          edit="folder"
          onSave={(changes) => actions.updateWorkspace(workspace.id, changes)}
          onClose={() => setChanging(false)}
        />
      )}
    </section>
  );
}
