import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { AgentPane } from "./agent/AgentPane";
import { TerminalView } from "./TerminalView";

interface PaneProps {
  session: SessionState;
  /** Whether this is in the Focused Pane. */
  focused: boolean;
}

/** A Session in one slot of the main view: a Claude Agent's conversation, or a terminal. */
export function Pane({ session, focused }: PaneProps) {
  if (session.kind === "claude" && session.interface === "agent") {
    return (
      <section aria-label={`Claude Agent ${session.name}`} className="h-full min-h-0">
        {session.status === "running" ? (
          <AgentPane session={session} focused={focused} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            This Session is Stopped. Restart it from the sidebar.
          </p>
        )}
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
