import type { SessionState } from "@/api";
import { TerminalView } from "./TerminalView";

/** A Session's terminal, filling one slot in the main view. */
export function Pane({ session, focused }: { session: SessionState; focused: boolean }) {
  return (
    <section
      aria-label={`Terminal ${session.name}`}
      className="h-full min-h-0 bg-black p-2"
    >
      <TerminalView sessionId={session.id} focused={focused} />
    </section>
  );
}
