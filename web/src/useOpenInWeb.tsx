import { type ReactNode, useState } from "react";
import { OpenInWebDialog } from "@/components/OpenInWebDialog";
import { useActions } from "@/useAppState";
import type { SessionState } from "../../src/shared/state-protocol.ts";

/**
 * Open in web for one Claude TUI, the same from the row menu and the top bar: `open()` asks
 * first for a running one (k-bench can't tell whether its Claude is busy) and switches a
 * Stopped one at once. Render `dialog` once, anywhere.
 */
export function useOpenInWeb(session: SessionState): {
  open: () => void;
  dialog: ReactNode;
} {
  const actions = useActions();
  const [asking, setAsking] = useState(false);
  const go = () => void actions.openInWeb(session.id);
  return {
    open: () => (session.status === "running" ? setAsking(true) : go()),
    dialog: <OpenInWebDialog open={asking} onOpenChange={setAsking} onConfirm={go} />,
  };
}
