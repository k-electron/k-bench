import { type ReactNode, useState } from "react";
import { whatWouldStop } from "@/agent/whatWouldStop";
import { OpenInTerminalDialog } from "@/components/OpenInTerminalDialog";
import { useActions } from "@/useAppState";
import type { SessionState } from "../../src/shared/state-protocol.ts";

/**
 * Open in terminal for one Claude Agent, the same from the row menu, the top bar and an
 * Unsupported row: `open()` switches the Session at once when nothing would be lost, and asks
 * first, listing what would stop, when it is working, waiting for the owner or has tasks
 * running. Render `dialog` once, anywhere.
 */
export function useOpenInTerminal(session: SessionState): {
  open: () => void;
  dialog: ReactNode;
} {
  const actions = useActions();
  const [asking, setAsking] = useState(false);
  const stops = whatWouldStop(session);
  const go = () => void actions.openInTerminal(session.id);
  return {
    open: () => (stops.length > 0 ? setAsking(true) : go()),
    dialog: (
      <OpenInTerminalDialog
        open={asking}
        onOpenChange={setAsking}
        stops={stops}
        onConfirm={go}
      />
    ),
  };
}
