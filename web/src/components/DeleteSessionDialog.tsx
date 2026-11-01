import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { buttonVariants } from "./ui/button";

/** Confirms deleting a Session, which ends its shell and everything running in it. */
export function DeleteSessionDialog({
  open,
  onOpenChange,
  sessionName,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string;
  onDelete: () => Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {sessionName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This ends its shell and everything running in it. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "default" })}
            onClick={() => void onDelete()}
          >
            Delete session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
