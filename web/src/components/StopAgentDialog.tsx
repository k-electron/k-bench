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

/** Asks before stopping a Claude Agent that is mid-turn (working, or waiting on an Allow/Deny). */
export function StopAgentDialog({
  open,
  onOpenChange,
  onStop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Claude is working. Stop anyway?</AlertDialogTitle>
          <AlertDialogDescription>
            This interrupts the turn that is running. The conversation stays, and Restart
            carries on from it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "default" })}
            onClick={onStop}
          >
            Stop
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
