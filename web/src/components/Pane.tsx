import { RotateCcwIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useActions } from "@/useAppState";
import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { TERMINAL_BACKGROUND } from "../terminalLook";
import { TerminalView } from "./TerminalView";
import { Button } from "./ui/button";

interface PaneProps {
  session: SessionState;
  /** Whether its terminal should have the keyboard. */
  focused: boolean;
  /** Whether its terminal also takes keyboard focus then; not in the Phone layout. */
  takesFocus?: boolean;
  /**
   * It is being started: while Stopped it shows nothing, not Restart, so its terminal
   * appears as soon as it runs.
   */
  starting?: boolean;
}

/**
 * A Session's terminal, filling one slot in the main view. A Stopped Session shows
 * Restart in its place.
 */
export function Pane({ session, focused, takesFocus, starting = false }: PaneProps) {
  return (
    <section
      aria-label={`Terminal ${session.name}`}
      className="h-full min-h-0 p-2"
      style={{ backgroundColor: TERMINAL_BACKGROUND }}
    >
      {session.status === "running" ? (
        <TerminalView
          sessionId={session.id}
          kind={session.kind}
          focused={focused}
          takesFocus={takesFocus}
        />
      ) : (
        !starting && <RestartNotice session={session} />
      )}
    </section>
  );
}

/** Centred in a Pane, on the terminal's background: why there is no terminal, and what to do. */
export function PaneNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Restart for a Stopped Session: a shell starts fresh, a Claude Session resumes. */
function RestartNotice({ session }: { session: SessionState }) {
  const actions = useActions();
  const [restarting, setRestarting] = useState(false);
  return (
    <PaneNotice>
      <p>{session.name} is Stopped.</p>
      <Button
        variant="secondary"
        size="sm"
        disabled={restarting}
        onClick={async () => {
          setRestarting(true);
          try {
            // A refusal shows in the sidebar.
            await actions.restartSession(session.id);
          } finally {
            setRestarting(false);
          }
        }}
      >
        <RotateCcwIcon />
        Restart
      </Button>
    </PaneNotice>
  );
}
