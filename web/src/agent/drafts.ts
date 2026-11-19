/**
 * The unsent text in a Claude Agent's input, kept per Agent in browser storage on the device
 * it was typed on, so a reload does not lose it. It is never sent anywhere: another device
 * has its own draft. Storage can be unavailable (a private window, blocked site data); then
 * nothing is kept and the input works as it would without this.
 */

const PREFIX = "k-bench.agent-draft.";

/** The draft left for the Agent, or "" when there is none. */
export function loadDraft(sessionId: string): string {
  try {
    return localStorage.getItem(PREFIX + sessionId) ?? "";
  } catch {
    return "";
  }
}

/** Keeps the draft for the Agent; an empty one is not kept. */
export function saveDraft(sessionId: string, text: string): void {
  try {
    if (text === "") localStorage.removeItem(PREFIX + sessionId);
    else localStorage.setItem(PREFIX + sessionId, text);
  } catch {
    // Storage unavailable: the draft just doesn't survive a reload.
  }
}

/** Forgets the draft of every Agent not in `existing` (deleted here or on another device). */
export function forgetDraftsOfMissing(existing: Set<string>): void {
  try {
    const stored: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) stored.push(key);
    }
    for (const key of stored) {
      if (!existing.has(key.slice(PREFIX.length))) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}
