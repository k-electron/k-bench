import { useSyncExternalStore } from "react";
import { isIPhone } from "./mirroredField";
import { useIsPhone } from "./useIsPhone";

/**
 * Whether Smart typing (ADR 0006) is on for a Session: offered only on an iPhone in the phone
 * layout, and there a per-Session choice kept on this device, in browser storage like the
 * Pane layout. A Session with no stored choice is on, so only the Sessions it is off for are
 * stored. Nothing about it reaches the server.
 */

const KEY = "k-bench.smart-typing";

/** The Sessions Smart typing is off for, by Session ID. */
function load(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((id) => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function save(off: Set<string>): void {
  try {
    if (off.size === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify([...off]));
  } catch {
    // Storage unavailable: the choice just doesn't survive a reload.
  }
}

let off = load();
const listeners = new Set<() => void>();

function change(next: Set<string>) {
  off = next;
  save(off);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the Session has Smart typing on, as chosen (on unless switched off). */
export function useSmartTypingChoice(sessionId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => !sessionId || !off.has(sessionId));
}

/** Switches Smart typing on or off for a Session. */
export function setSmartTyping(sessionId: string, on: boolean): void {
  if (off.has(sessionId) === !on) return;
  const next = new Set(off);
  if (on) next.delete(sessionId);
  else next.add(sessionId);
  change(next);
}

/** Forgets the choice of every Session not in `existing` (deleted here or on another device). */
export function forgetSmartTypingOfMissing(existing: Set<string>): void {
  const kept = new Set([...off].filter((id) => existing.has(id)));
  if (kept.size !== off.size) change(kept);
}

/** Whether Smart typing is offered here at all: an iPhone, in the phone layout. */
export function useSmartTypingOffered(): boolean {
  const phone = useIsPhone();
  return phone && isIPhone();
}
