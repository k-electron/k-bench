import type { SessionState } from "@/api";
import { TerminalView } from "./TerminalView";

/** One slot in the main view, showing one Session. */
export function Pane({ session }: { session: SessionState }) {
  return (
    <section
      aria-label={`Terminal ${session.name}`}
      className="h-full min-h-0 bg-black p-2"
    >
      <TerminalView sessionId={session.id} />
    </section>
  );
}
