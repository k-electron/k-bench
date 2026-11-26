import { cn } from "@/lib/utils";
import type { SessionState } from "../../../src/shared/state-protocol.ts";

/**
 * A Session's marker slot beside its Tab, its Rail and its Pane's label bar: for now only
 * an amber dot while its Bell is raised. It sits outside the button it marks, so its
 * label never joins that button's accessible name.
 */
export function SessionMarker({
  session,
  className,
}: {
  session: SessionState;
  className?: string;
}) {
  if (!session.bell) return null;
  const label = `${session.name} rang the bell`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("size-2 shrink-0 rounded-full bg-status-bell", className)}
    />
  );
}
