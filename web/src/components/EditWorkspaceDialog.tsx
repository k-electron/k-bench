import { useState } from "react";
import type { WorkspaceState } from "@/api";
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

/** Renames a Workspace or changes its folder, showing the server's message when refused. */
export function EditWorkspaceDialog({
  workspace,
  edit,
  onSave,
  onClose,
}: {
  workspace: WorkspaceState;
  edit: WorkspaceEdit;
  onSave: (changes: { name?: string; folder?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const renaming = edit === "rename";
  const [value, setValue] = useState(renaming ? workspace.name : workspace.folder);
  const [error, setError] = useState<string>();

  const submit = async () => {
    try {
      const trimmed = value.trim();
      await onSave(renaming ? { name: trimmed } : { folder: trimmed });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
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
          <Input
            aria-label={renaming ? "Name" : "Folder path"}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(undefined);
            }}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={value.trim() === ""}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
