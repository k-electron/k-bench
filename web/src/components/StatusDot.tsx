import { cn } from "@/lib/utils";
import type { Marker } from "@/workspaces";

/**
 * What each marker says of the Session or Sessions it marks, after their name ("Prime is
 * waiting for you", "A session in another workspace rang the bell"), so the states aren't
 * colour-only.
 */
export const MARKER_SAYS: Record<Marker, string> = {
  waiting: "is waiting for you",
  bell: "rang the bell",
  working: "is working",
  idle: "is idle",
};

/** The markers a dot shows; Working is a spinner instead. */
export type DotMarker = Exclude<Marker, "working">;

const COLOURS: Record<DotMarker, string> = {
  waiting: "bg-status-waiting",
  bell: "bg-status-bell",
  idle: "bg-status-idle",
};

/**
 * A marker's dot: amber with a pulsing ring for Waiting, solid amber for a Bell, grey for
 * Idle. It is only the picture: whoever places it labels it. `className` sets its size,
 * place and any ring around it. Hand-built, since shadcn has no status dot.
 */
export function StatusDot({
  marker,
  className,
}: {
  marker: DotMarker;
  className?: string;
}) {
  return (
    <span
      className={cn("relative size-2 shrink-0 rounded-full", COLOURS[marker], className)}
    >
      {marker === "waiting" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-status-waiting/70" />
      )}
    </span>
  );
}
