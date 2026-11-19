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

/**
 * Asks before Open in web ends the terminal's Claude Code. It always asks for a running Claude
 * TUI, because k-bench can't tell whether that Claude is busy.
 */
export function OpenInWebDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open in web?</AlertDialogTitle>
          <AlertDialogDescription>
            k-bench can't tell whether Claude is busy in the terminal. If it is, what it
            is doing stops. The conversation carries on here, with the terminal's turns
            added.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "default" })}
            onClick={onConfirm}
          >
            Open in web
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
