import { useSyncExternalStore } from "react";

/**
 * Input that does not come from the keyboard: the phone's extra-keys row. It reaches the
 * shell through the same path as typed keys (the terminal's `onData`), so the one-shot
 * Ctrl modifier below applies to both.
 */

interface RegisteredTerminal {
  send: (data: string) => void;
  /** Pastes `text` the way the terminal's own paste does: bracketed when the program asked for it. */
  paste: (text: string) => void;
  blur: () => void;
  /** Ends the line Smart typing mirrors in the terminal's hidden field; a no-op when it is off. */
  clearTypedLine: () => void;
}

let registered: RegisteredTerminal | null = null;

/**
 * Registers the terminal that extra keys go to (the one in the Focused Pane), how to take
 * keyboard focus off it, and how to end the line Smart typing mirrors: every Extra key is a
 * key that isn't text, so it ends that line.
 */
export function registerTerminal(terminal: RegisteredTerminal): () => void {
  registered = terminal;
  return () => {
    if (registered === terminal) registered = null;
  };
}

/** Takes focus off the registered terminal, which closes the on-screen keyboard. */
export function closeKeyboard(): void {
  registered?.blur();
}

/** The keys of the Extra keys and the compact keys over the terminal, as the terminal gets them. */
export const KEYS = {
  esc: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  enter: "\r",
  left: "\x1b[D",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
} as const;

/** Sends `data` to the registered terminal as if it had been typed. */
export function sendKey(data: string): void {
  registered?.send(data);
  registered?.clearTypedLine();
}

/** Whether this browser can read the clipboard at all; a page over plain http has no `navigator.clipboard`. */
export function canReadClipboard(): boolean {
  return typeof navigator.clipboard?.readText === "function";
}

/**
 * Pastes the clipboard's text into the registered terminal. The read starts inside the
 * caller's tap, with nothing before it: WebKit rejects a clipboard read made outside a user
 * gesture. A read that is rejected (permission denied, or the iPhone's "Paste" callout
 * dismissed) does nothing, silently.
 */
export function pasteFromClipboard(): void {
  let read: Promise<string>;
  try {
    read = navigator.clipboard.readText();
  } catch {
    return;
  }
  read
    .then((text) => {
      if (!text) return;
      // The paste passes through the terminal's input like typing does, where an armed Ctrl
      // would turn a single pasted character into a control character.
      setCtrl(false);
      registered?.paste(text);
      // The terminal's paste blanked the hidden field; this puts Smart typing's filler back.
      registered?.clearTypedLine();
    })
    .catch(() => {});
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

/** Whether Ctrl is armed, for the next key to be sent with it. */
export function isCtrlArmed(): boolean {
  return ctrlArmed;
}

export function toggleCtrl(): void {
  registered?.clearTypedLine();
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
