import { type ReactNode, useId, useState } from "react";
import { basename, choicePath, type FolderChoice } from "@/folders";
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
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";

/**
 * Creates a Workspace on a folder picked from the Host, making any new folders named in the
 * picker first.
 */
export function NewWorkspaceDialog({
  workspaces,
  onCreate,
  trigger,
}: {
  workspaces: WorkspaceState[];
  /** The button that opens it, labelled "New Workspace". */
  trigger: ReactNode;
  onCreate: (input: {
    folder: string;
    name?: string;
    createMissingFolders?: boolean;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<FolderChoice>();
  const folder = choice && choicePath(choice);
  const newFolders = choice?.newFolders.length ?? 0;
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const nameId = useId();

  const submit = async () => {
    if (folder === undefined) return;
    try {
      await onCreate({
        folder,
        name: name.trim() || undefined,
        ...(newFolders > 0 && { createMissingFolders: true }),
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName("");
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={FOLDER_DIALOG_CLASS}>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
            <DialogDescription>
              Pick a project folder on the Host, or make new ones for it.
            </DialogDescription>
          </DialogHeader>
          <FolderPicker
            workspaces={workspaces}
            onChange={(chosen) => {
              setChoice(chosen);
              setError(undefined);
            }}
          />
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={nameId}>Name</label>
            <Input
              id={nameId}
              // Follows the folder until the owner types a name of their own.
              placeholder={folder === undefined ? "" : basename(folder) || "/"}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(undefined);
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={folder === undefined}>
              {newFolders === 0
                ? "Create Workspace"
                : newFolders === 1
                  ? "Create folder and Workspace"
                  : `Create ${newFolders} folders and Workspace`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
