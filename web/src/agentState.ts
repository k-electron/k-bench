import { useEffect, useState } from "react";
import type { SessionState } from "../../src/shared/state-protocol.ts";

/**
 * What a Claude Agent shows as its state, everywhere it is shown (the sidebar row and the top
 * bar): Idle, Working, Waiting for you, or Stopped.
 */
export type AgentDisplayState = "idle" | "working" | "waiting" | "stopped";

/** The words the owner reads, and the accessible names the dots carry. */
export const AGENT_STATE_LABEL: Record<AgentDisplayState, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting for you",
  stopped: "Stopped",
};

/**
 * The state to show for a Session that is a Claude Agent, or undefined for anything else, and
 * for an Agent that runs but whose runtime the server has not heard from yet (it then shows
 * as any running Session does, rather than as Idle when it may not be).
 */
export function agentDisplayState(session: SessionState): AgentDisplayState | undefined {
  if (session.kind !== "claude" || session.interface !== "agent") return undefined;
  if (session.status === "stopped") return "stopped";
  return session.agent?.state;
}

/** Whether the Session is a Claude Agent that is Waiting for you. */
export const isWaiting = (session: SessionState): boolean =>
  agentDisplayState(session) === "waiting";

/** `42s`, `3m 05s`, `1h 02m`: how long a turn has run. */
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The time now, as of the last tick, while `active`. Ticks once a second. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
