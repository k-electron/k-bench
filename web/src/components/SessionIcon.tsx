import { CrownIcon, HammerIcon, SparklesIcon, TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionState } from "../../../src/shared/state-protocol.ts";

/**
 * A Session's icon: a crown for the Prime, a hammer for the Worker, a sparkle for any other
 * Claude Session and a terminal for a shell. Size it with `className`.
 */
export function SessionIcon({
  session,
  className,
}: {
  session: Pick<SessionState, "role" | "kind">;
  className?: string;
}) {
  const shared = cn("shrink-0", className);
  if (session.role === "prime")
    return <CrownIcon className={cn(shared, "text-orange-400")} />;
  if (session.role === "worker") {
    return <HammerIcon className={cn(shared, "text-orange-300")} />;
  }
  if (session.kind === "claude") {
    return <SparklesIcon className={cn(shared, "text-orange-500")} />;
  }
  return <TerminalIcon className={cn(shared, "text-muted-foreground")} />;
}
