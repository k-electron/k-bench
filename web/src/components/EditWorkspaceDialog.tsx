import { useId, useState } from "react";
import { choicePath, type FolderChoice } from "@/folders";
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
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export type WorkspaceEdit = "rename" | "folder";

/**
 * Renames a Workspace or changes its folder (picked from the Host, making any new folders
 * named there), showing the server's message when refused. The picker opens at the
 * Workspace's own folder (the nearest one above it that exists, when it is Missing), and
 * Save waits until the owner picks a different folder.
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
  onSave: (changes: {
    name?: string;
    folder?: string;
    createMissingFolders?: boolean;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const renaming = edit === "rename";
  const [name, setName] = useState(workspace.name);
  // Set only once the owner has moved in the picker.
  const [choice, setChoice] = useState<FolderChoice>();
  const [error, setError] = useState<string>();
  const nameId = useId();
  const folder = choice && choicePath(choice);
  const value = renaming ? name.trim() : folder === workspace.folder ? undefined : folder;

  const submit = async () => {
    if (!value) return;
    try {
      await onSave(
        renaming
          ? { name: value }
          : {
              folder: value,
              ...((choice?.newFolders.length ?? 0) > 0 && { createMissingFolders: true }),
            },
      );
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
            <Field>
              <FieldLabel htmlFor={nameId}>Name</FieldLabel>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(undefined);
                }}
                autoFocus
              />
            </Field>
          ) : (
            <FolderPicker
              workspaces={workspaces}
              start={workspace.folder}
              onChange={(chosen, picked) => {
                setChoice(picked ? chosen : undefined);
                setError(undefined);
              }}
            />
          )}
          {error && <FieldError>{error}</FieldError>}
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
