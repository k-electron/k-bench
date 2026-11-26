import { cn } from "@/lib/utils";
import { type Marker, sessionMarker } from "@/workspaces";
import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { Spinner } from "./ui/spinner";

/** What each marker says after the Session's name. */
const LABELS: Record<Marker, string> = {
  waiting: "is waiting for you",
  bell: "rang the bell",
  working: "is working",
  idle: "is idle",
};

/**
 * A Session's one marker (see `sessionMarker`), in its slot on its sidebar row, the collapsed
 * sidebar's icon, its Tab, its Rail, the left Pane's label bar, the phone's title and its
 * row in the Sessions sheet. Working is a small blue `Spinner`; Waiting is an amber dot with
 * a pulsing ring, the Bell a solid amber dot and Idle a grey one. Every marker is an image
 * labelled "<name> is working" and so on, so the states aren't colour-only. It sits beside
 * the button it marks, never inside, so its label is read on its own and stays out of that
 * button's accessible name. Hand-built from `Spinner` and plain dots: shadcn has no status
 * dot.
 */
export function SessionMarker({
  session,
  className,
}: {
  session: SessionState;
  className?: string;
}) {
  const marker = sessionMarker(session);
  if (!marker) return null;
  const label = `${session.name} ${LABELS[marker]}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("relative grid size-3.5 shrink-0 place-items-center", className)}
    >
      {marker === "working" ? (
        // Hidden, so the Spinner's own "Loading" status isn't announced over this label.
        <Spinner aria-hidden="true" className="size-3.5 text-primary" />
      ) : (
        <>
          {marker === "waiting" && (
            <span className="absolute size-2.5 animate-ping rounded-full bg-status-waiting/70" />
          )}
          <span
            className={cn(
              "relative size-2 rounded-full",
              marker === "idle" ? "bg-status-idle" : "bg-status-bell",
            )}
          />
        </>
      )}
    </span>
  );
}
