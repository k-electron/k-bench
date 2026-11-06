import type { Terminal } from "@xterm/xterm";
import type { SessionKind } from "../../src/shared/state-protocol.ts";
import { sessionEdit } from "./smartTypingEdit";
import { isCtrlArmed } from "./terminalInput";

/**
 * Smart typing (ADR 0006): the terminal's hidden field keeps the text the owner has typed,
 * so the iPhone keyboard's typing aids work on it, and each change the keyboard makes to it
 * reaches the Session as Backspaces and new text. This module is the DOM and xterm.js side;
 * `smartTypingEdit.ts` is the comparison.
 */

/** Smart typing is offered on an iPhone (iOS WebKit, whatever the browser), not an iPad or Android. */
export function isIPhone(): boolean {
  return /iPhone/.test(navigator.userAgent);
}

export interface MirroredField {
  /** Empties the field: the next keyboard edit starts a fresh line. */
  clear(): void;
  /** Gives the hidden field back to xterm.js, as it was. */
  dispose(): void;
}

/** The keys that only modify other keys: they neither type nor end a line. */
const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "CapsLock",
  "Fn",
  "FnLock",
  "NumLock",
  "ScrollLock",
]);

/** `key` values that say the keyboard is composing text, which arrives as an input event. */
const COMPOSING_KEYS = new Set(["Dead", "Process", "Unidentified", "Compose"]);

/** The keyboard settings iOS reads off the field when the keyboard opens. */
const KEYBOARD_SETTINGS: Record<SessionKind, Record<string, string>> = {
  // `autocorrect="off"` keeps the suggestion bar, double-space period, swipe and hold to
  // delete, but does not replace words (`ls` would become `Is`) or capitalise them.
  shell: { autocorrect: "off", autocapitalize: "none", spellcheck: "true" },
  claude: { autocorrect: "on", autocapitalize: "sentences", spellcheck: "true" },
};

/**
 * Invisible characters (zero-width spaces) a freshly cleared field starts with, before the
 * caret. They count as text already in the program, so deleting one sends a Backspace and a
 * held ⌫ keeps repeating, and speeds up, past what the owner typed: iOS never repeats
 * Backspace in an empty field, and reports the key released at once.
 */
const FILLER = "\u200b".repeat(120);

/** The settings xterm.js gives its field, for putting them back. */
const XTERM_SETTINGS: Record<string, string> = {
  autocorrect: "off",
  autocapitalize: "off",
  spellcheck: "false",
};

/** Input types that carry pasted or dropped text: that goes through the terminal's paste, not the comparison. */
const PASTE_INPUT = /^insertFrom(Paste|Drop|Yank)/;

function setAttributes(element: HTMLElement, attributes: Record<string, string>) {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
}

/**
 * Takes over the terminal's input from xterm.js, which would type through an empty field,
 * and returns how to clear the field and how to hand it back. Everything it sends goes
 * through `terminal.input`, the path the Extra keys use, so the one-shot Ctrl, input
 * queued while the connection opens and reconnect handling apply to it.
 *
 * It relies on xterm.js keeping its hidden field inside `terminal.element` and routing its
 * key handling through `attachCustomKeyEventHandler`; if the field is missing it warns and
 * leaves input exactly as xterm.js has it (undefined).
 */
export function mirrorTypedLine(
  terminal: Terminal,
  kind: SessionKind,
): MirroredField | undefined {
  const { element, textarea } = terminal;
  if (!element || !textarea) {
    console.warn("xterm.js no longer exposes its input field; Smart typing is off");
    return undefined;
  }
  const field = textarea;

  /** The field's text as of the last change sent to the Session. */
  let typed = "";

  function clear() {
    // WebKit only forgets the keyboard's idea of the text when a page empties the field.
    field.value = "";
    field.value = FILLER;
    field.setSelectionRange(FILLER.length, FILLER.length);
    typed = field.value;
  }

  function send(data: string) {
    const ctrl = isCtrlArmed();
    terminal.input(data, true);
    // A letter typed with Ctrl armed was that Ctrl key, not text.
    if (ctrl) clear();
  }

  // Keys: text goes to the field (and arrives as an input event), a key that isn't text goes
  // to the program as xterm.js sends it and ends the line.
  terminal.attachCustomKeyEventHandler((event) => {
    const { key } = event;
    if (MODIFIER_KEYS.has(key)) return true;
    const typesText = () => !event.ctrlKey && !event.metaKey;

    if (key === "Backspace") {
      // In a field with text the keyboard deletes it, and the input event says so; in an
      // empty one there is nothing to delete, so the Backspace goes to the program.
      if (typesText() && field.value !== "") return false;
    } else if (key === "Enter") {
      // iOS sends Enter before it applies a pending correction. It is sent when the field
      // reports the line break, after the correction.
      if (!event.shiftKey && !event.altKey && typesText()) return false;
    } else if (COMPOSING_KEYS.has(key) || (key.length === 1 && typesText())) {
      return false;
    }
    if (event.type === "keydown") clear();
    return true;
  });

  const onInput = (event: Event) => {
    if (event.target !== field) return;
    // xterm.js would type the text itself (or, for a line break, ignore it).
    event.stopPropagation();
    const { inputType } = event as InputEvent;
    if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
      send("\r");
      clear();
    } else if (PASTE_INPUT.test(inputType)) {
      clear();
    } else {
      const after = field.value;
      const { backspaces, text } = sessionEdit(typed, after);
      typed = after;
      // A line break typed as text is Enter, never a `\n`.
      const data = "\x7f".repeat(backspaces) + text.replace(/\r?\n/g, "\r");
      if (data) send(data);
    }
  };

  // Composition arrives as input events too, so xterm.js's own handling of it is kept off.
  let composing = false;
  const onComposition = (event: Event) => {
    if (event.target !== field) return;
    composing = event.type !== "compositionend";
    event.stopPropagation();
  };
  // xterm.js sends a paste itself, bracketed when the program asked for it; the field is
  // then cleared so the pasted text is not mistaken for typing.
  const onPaste = (event: Event) => {
    if (event.target === field) clear();
  };
  const onBlur = () => clear();

  // A spacebar drag moves the field's caret without typing, and a letter typed at the start
  // of the field would not arrive as typed. The caret is put back at the end, unless the
  // keyboard is composing, whose text the caret then sits in.
  const onSelectionChange = () => {
    if (composing || document.activeElement !== field) return;
    const { selectionStart, selectionEnd, value } = field;
    if (selectionStart === selectionEnd && selectionStart !== value.length) {
      field.setSelectionRange(value.length, value.length);
    }
  };

  const listenFor = (type: string, listener: (event: Event) => void) =>
    element.addEventListener(type, listener, true);
  listenFor("input", onInput);
  listenFor("compositionstart", onComposition);
  listenFor("compositionupdate", onComposition);
  listenFor("compositionend", onComposition);
  listenFor("paste", onPaste);
  field.addEventListener("blur", onBlur);
  document.addEventListener("selectionchange", onSelectionChange);

  setAttributes(field, KEYBOARD_SETTINGS[kind]);
  clear();

  return {
    clear,
    dispose() {
      for (const [type, listener] of [
        ["input", onInput],
        ["compositionstart", onComposition],
        ["compositionupdate", onComposition],
        ["compositionend", onComposition],
        ["paste", onPaste],
      ] as const) {
        element.removeEventListener(type, listener, true);
      }
      field.removeEventListener("blur", onBlur);
      document.removeEventListener("selectionchange", onSelectionChange);
      terminal.attachCustomKeyEventHandler(() => true);
      setAttributes(field, XTERM_SETTINGS);
      field.value = "";
    },
  };
}
