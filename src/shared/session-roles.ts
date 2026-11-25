/**
 * Telling a Workspace's Sessions apart by role, the one way the server and the browser both
 * do it. Imported by the browser too, so this file has no Node APIs.
 */
import type { SessionRole } from "./state-protocol.ts";

/** A Workspace's Sessions by role. */
export interface SessionsByRole<S> {
  prime: S | undefined;
  worker: S | undefined;
  /** The Prime, then the Worker: those there are. */
  primeAndWorker: S[];
  /** The Other Sessions, in the order they were given. */
  others: S[];
}

/** Sorts a Workspace's Sessions into its Prime, its Worker and its Other Sessions. */
export function sessionsByRole<S extends { role: SessionRole | null }>(
  sessions: readonly S[],
): SessionsByRole<S> {
  const prime = sessions.find((s) => s.role === "prime");
  const worker = sessions.find((s) => s.role === "worker");
  return {
    prime,
    worker,
    primeAndWorker: [prime, worker].filter((s): s is S => s !== undefined),
    others: sessions.filter((s) => s.role === null),
  };
}
