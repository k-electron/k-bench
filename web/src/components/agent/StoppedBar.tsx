import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { useActions } from "@/useAppState";
import { Button } from "../ui/button";

/**
 * Where the input was, in a Stopped Claude Agent's Pane: why it stopped, and Restart, which
 * resumes the same conversation with the same Launch options. The Transcript above stays
 * readable; nothing can be sent until the Agent runs again.
 */
export function StoppedBar({ sessionId, reason }: { sessionId: string; reason: string }) {
  const actions = useActions();
  const [restarting, setRestarting] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-3 border-t px-3 py-2">
      <p role="status" className="min-w-0 flex-1 text-sm break-words">
        <span aria-hidden>⏹ </span>Stopped: {reason}
      </p>
      <Button
        size="sm"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          // A refusal is shown by the sidebar's alert; the button comes back for another try.
          void actions.restartSession(sessionId).finally(() => setRestarting(false));
        }}
      >
        <RotateCcwIcon />
        Restart
      </Button>
    </div>
  );
}
