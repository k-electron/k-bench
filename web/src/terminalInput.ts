import { useSyncExternalStore } from "react";

/**
 * Input that does not come from the keyboard: the phone's extra-keys row. It reaches the
 * shell through the same path as typed keys (the terminal's `onData`), so the one-shot
 * Ctrl modifier below applies to both.
 */

let sender: ((data: string) => void) | null = null;

/** Registers the terminal that extra keys go to (the one in the Focused Pane). */
export function registerTerminal(send: (data: string) => void): () => void {
  sender = send;
  return () => {
    if (sender === send) sender = null;
  };
}

/** Sends `data` to the registered terminal as if it had been typed. */
export function sendKey(data: string): void {
  sender?.(data);
}

let ctrlArmed = false;
const listeners = new Set<() => void>();

function setCtrl(armed: boolean) {
  if (ctrlArmed === armed) return;
  ctrlArmed = armed;
  for (const listener of listeners) listener();
}

/** Whether the next key will be sent with Ctrl held. */
export function useCtrlArmed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ctrlArmed,
  );
}

export function toggleCtrl(): void {
  setCtrl(!ctrlArmed);
}

const CTRL_PUNCTUATION: Record<string, string> = {
  " ": "\x00",
  "@": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "^": "\x1e",
  _: "\x1f",
  "?": "\x7f",
};

/** What `data` becomes with Ctrl held: Ctrl+c is 0x03. Anything else is left as it is. */
export function withCtrl(data: string): string {
  if (data.length !== 1) return data;
  if (/^[a-z]$/i.test(data)) {
    return String.fromCharCode(data.toLowerCase().charCodeAt(0) - 96);
  }
  return CTRL_PUNCTUATION[data] ?? data;
}

/**
 * Runs typed or extra-key input past the Ctrl modifier: if Ctrl is armed it is applied to
 * this input and disarmed, so it affects the next key only.
 */
export function applyArmedCtrl(data: string): string {
  if (!ctrlArmed) return data;
  setCtrl(false);
  return withCtrl(data);
}
