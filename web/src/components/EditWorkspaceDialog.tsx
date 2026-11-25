import { useState } from "react";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { FOLDER_DIALOG_CLASS, FolderPicker } from "./FolderPicker";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export type WorkspaceEdit = "rename" | "folder";

/**
 * Renames a Workspace or changes its folder (picked from the Host), showing the server's
 * message when refused.
 */
export function EditWorkspaceDialog({
  workspace,
  workspaces,
  edit,
  onSave,
  onClose,
}: {
  workspace: WorkspaceState;
  /** Every live Workspace, for the folder picker. */
  workspaces: WorkspaceState[];
  edit: WorkspaceEdit;
  onSave: (changes: { name?: string; folder?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const renaming = edit === "rename";
  const [name, setName] = useState(workspace.name);
  const [folder, setFolder] = useState<string>();
  const [error, setError] = useState<string>();
  const value = renaming ? name.trim() : folder;

  const submit = async () => {
    if (!value) return;
    try {
      await onSave(renaming ? { name: value } : { folder: value });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={renaming ? undefined : FOLDER_DIALOG_CLASS}>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{renaming ? "Rename Workspace" : "Change folder"}</DialogTitle>
            <DialogDescription>
              {renaming
                ? `Choose a new name for ${workspace.name}.`
                : `Point ${workspace.name} at another folder on the Host. Running Sessions carry on where they are.`}
            </DialogDescription>
          </DialogHeader>
          {renaming ? (
            <Input
              aria-label="Name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(undefined);
              }}
              autoFocus
            />
          ) : (
            <FolderPicker
              workspaces={workspaces}
              onChange={(chosen) => {
                setFolder(chosen);
                setError(undefined);
              }}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!value}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
