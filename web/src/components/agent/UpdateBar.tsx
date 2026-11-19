import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { useActions } from "@/useAppState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button, buttonVariants } from "../ui/button";

/**
 * Why a running Claude Agent is offered Restart: `update`, k-bench was updated to another
 * build of the Agent Runtime and this Agent keeps working on the old one until the owner
 * says; `incompatible`, the runtime speaks a protocol this k-bench does not, so it cannot be
 * read or written to at all.
 */
export type RestartReason = "update" | "incompatible";

const WORDS: Record<RestartReason, string> = {
  update:
    "Update available: this Agent keeps working as it is. Restart to move it to the new version; the conversation carries on.",
  incompatible:
    "This Agent was started by an older k-bench and can't be read by this one. Restart to carry on the same conversation.",
};

/**
 * The strip in a running Agent's Pane that offers Restart for an update or an incompatible
 * runtime. Restart interrupts a turn that is running, so it asks first then (`midTurn`).
 * What the Pane shows follows the Session's state, here and on every device, once the new
 * runtime is up.
 */
export function UpdateBar({
  sessionId,
  reason,
  midTurn,
}: {
  sessionId: string;
  reason: RestartReason;
  midTurn: boolean;
}) {
  const actions = useActions();
  const [restarting, setRestarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const restart = () => {
    setRestarting(true);
    // A refusal is shown by the sidebar's alert; the button comes back for another try.
    void actions.restartAgent(sessionId).finally(() => setRestarting(false));
  };
  return (
    <div className="flex shrink-0 items-center gap-3 border-t px-3 py-2">
      <p role="status" className="min-w-0 flex-1 text-sm break-words">
        {WORDS[reason]}
      </p>
      <Button
        size="sm"
        disabled={restarting}
        onClick={() => (midTurn ? setConfirming(true) : restart())}
      >
        <RotateCcwIcon />
        Restart
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Claude is working. Restart anyway?</AlertDialogTitle>
            <AlertDialogDescription>
              This interrupts the turn that is running. The conversation stays, and
              carries on after the restart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={buttonVariants({ variant: "ghost" })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "default" })}
              onClick={restart}
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
