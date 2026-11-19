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
 * Asks before Open in terminal ends something: a turn, an open prompt, or tasks still running.
 * `stops` is what `whatWouldStop` listed, so the owner sees what would stop.
 */
export function OpenInTerminalDialog({
  open,
  onOpenChange,
  stops,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stops: string[];
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open in terminal?</AlertDialogTitle>
          <AlertDialogDescription>
            The Claude Agent ends and Claude Code carries on the same conversation in the
            terminal.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul aria-label="What would stop" className="list-disc space-y-1 pl-5 text-sm">
          {stops.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "default" })}
            onClick={onConfirm}
          >
            Open in terminal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
