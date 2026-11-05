import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { TerminalView } from "./TerminalView";

interface PaneProps {
  session: SessionState;
  /** Whether this is in the Focused Pane. */
  focused: boolean;
}

/** A Session's terminal, filling one slot in the main view. */
export function Pane({ session, focused }: PaneProps) {
  return (
    <section
      aria-label={`Terminal ${session.name}`}
      className="h-full min-h-0 bg-black p-2"
    >
      {session.status === "running" ? (
        <TerminalView sessionId={session.id} focused={focused} />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          This Session is Stopped. Restart it from the sidebar to get a fresh shell.
        </p>
      )}
    </section>
  );
}
