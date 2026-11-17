import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { AgentPrototype, useAgentPrototype } from "../agentPrototype/AgentPrototype";
import { TerminalView } from "./TerminalView";

interface PaneProps {
  session: SessionState;
  /** Whether this is in the Focused Pane. */
  focused: boolean;
}

/** A Session's terminal, filling one slot in the main view. */
export function Pane({ session, focused }: PaneProps) {
  // PROTOTYPE, throwaway: `?agent=A|B|C` shows a fake Claude Agent conversation instead.
  const prototype = useAgentPrototype();
  if (prototype.variant) {
    return (
      <section
        aria-label={`Claude Agent prototype ${session.name}`}
        className="h-full min-h-0"
      >
        <AgentPrototype focused={focused} />
      </section>
    );
  }
  return (
    <section
      aria-label={`Terminal ${session.name}`}
      className="h-full min-h-0 bg-black p-2"
    >
      {session.status === "running" ? (
        <TerminalView sessionId={session.id} kind={session.kind} focused={focused} />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          This Session is Stopped. Restart it from the sidebar to get a fresh shell.
        </p>
      )}
    </section>
  );
}
