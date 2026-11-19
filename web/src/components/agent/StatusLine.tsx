import { useEffect, useState } from "react";
import { elapsedSeconds } from "../../agent/activity";

/** The current time, updated every second while `active` (and only then: it re-renders its user). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The line under the conversation. While Claude works it says what Claude is doing and for how
 * long (`✻ Running Bash… (12s)`), and it goes when the turn ends. When Claude Code has reported
 * it, it also says how much context is left until Claude Code compacts by itself, as the terminal
 * does; that stays, because it is what the owner glances at between turns.
 */
export function StatusLine({
  working,
  waiting,
  activity,
  turnStartedAt,
  contextLeft,
}: {
  /** A turn is running (Working, or Waiting for you). */
  working: boolean;
  /** An Allow/Deny ask is open: the line says so instead of what Claude was doing. */
  waiting: boolean;
  /** What Claude is doing now: "Thinking", "Running Bash". */
  activity: string;
  /** When the turn began (the runtime's clock), for the seconds. */
  turnStartedAt: number | undefined;
  /** Percent of context left until auto-compact, when Claude Code has said. */
  contextLeft: number | undefined;
}) {
  const now = useNow(working && turnStartedAt !== undefined);
  if (!working && contextLeft === undefined) return null;
  return (
    <div className="flex shrink-0 flex-wrap justify-between gap-x-4 px-3 pb-1 font-mono text-xs text-muted-foreground">
      {working && (
        <div role="status" aria-label="Claude status">
          <span aria-hidden className="inline-block animate-spin">
            ✻
          </span>{" "}
          {waiting ? "Waiting for you" : `${activity}…`}
          {turnStartedAt !== undefined && ` (${elapsedSeconds(turnStartedAt, now)}s)`}
        </div>
      )}
      {contextLeft !== undefined && (
        <div role="note" aria-label="Context left" className="ml-auto">
          Context left until auto-compact: {contextLeft}%
        </div>
      )}
    </div>
  );
}
