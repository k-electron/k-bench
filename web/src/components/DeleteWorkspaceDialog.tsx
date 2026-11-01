import { useState } from "react";
import type { WorkspaceState } from "@/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button, buttonVariants } from "./ui/button";

/** Asks before deleting a Workspace; confirming ends all its Sessions. */
export function DeleteWorkspaceDialog({
  workspace,
  onDelete,
  onClose,
}: {
  workspace: WorkspaceState;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const count = workspace.sessions.length;

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 0
              ? "The Workspace is removed. "
              : `Its ${count === 1 ? "Session" : `${count} Sessions`} will be ended and everything running in ${count === 1 ? "it" : "them"} stopped. `}
            The folder on disk is not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              onDelete().then(onClose, (e) =>
                setError(e instanceof Error ? e.message : String(e)),
              );
            }}
          >
            Delete Workspace
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
