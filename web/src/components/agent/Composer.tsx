import { SendIcon, SquareIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadDraft, saveDraft } from "@/agent/drafts";
import { Button } from "@/components/ui/button";
import { useIsPhone } from "@/useIsPhone";

/**
 * The input box under a Claude Agent's conversation. On desktop, Enter sends and Shift+Enter
 * starts a new line. On a phone, Return starts a new line and the Send button sends: there is
 * no Enter to reach for, and an on-screen keyboard's Return is for writing. The box grows
 * with what is typed. It takes no Extra keys and no Smart typing: it is an ordinary field.
 *
 * It never locks while Claude works: what is sent then goes straight to Claude Code and waits
 * its turn. While a turn runs an Interrupt button sits by the box (and Esc does the same on
 * desktop). In an empty box, Up recalls the prompts typed in this Agent, newest first, and
 * Down goes back, as in a terminal.
 * What is typed and not sent is kept as a draft on this device, per Agent, until it is sent.
 */
export function Composer({
  sessionId,
  onSend,
  disabled,
  offline,
  autoFocus,
  onShiftTab,
  history,
  working,
  interrupting,
  onInterrupt,
}: {
  /** The Agent's Session ID: whose draft the box keeps. */
  sessionId: string;
  /** Sends the text; false when it could not be sent (reconnecting), and the box keeps it. */
  onSend: (text: string) => boolean;
  /** The Agent has ended: nothing can be sent. */
  disabled: boolean;
  /** The connection is down: the box stays editable, but Send waits for it to come back. */
  offline: boolean;
  autoFocus: boolean;
  /** Shift+Tab on desktop: the box keeps the key for this (and the focus) when it is given. */
  onShiftTab?: () => void;
  /** The prompts typed in this Agent, oldest first. */
  history: readonly string[];
  /** A turn is running: the Interrupt button shows. */
  working: boolean;
  /** An interrupt is on its way: the button waits for the turn to end. */
  interrupting: boolean;
  /** Interrupts the turn; false when nothing was sent. */
  onInterrupt: () => boolean;
}) {
  const phone = useIsPhone();
  const [text, setText] = useState(() => loadDraft(sessionId));
  /**
   * Which earlier prompt the box shows, counted back from the newest (1 is the newest); none
   * when the box holds what was typed. Editing the recalled text ends the recall.
   */
  const [back, setBack] = useState<number | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  const caretAtEnd = useRef(false);

  const recalled = back === undefined ? undefined : history[history.length - back];
  const recalling = recalled !== undefined && text === recalled;

  // The Focused Pane's box takes the keyboard, as its terminal would. Not on a phone, where
  // focusing raises the on-screen keyboard over the conversation.
  useEffect(() => {
    if (autoFocus && !phone) field.current?.focus();
  }, [autoFocus, phone]);

  // A recalled prompt leaves the caret at its end, where the owner carries on from.
  useLayoutEffect(() => {
    const element = field.current;
    if (caretAtEnd.current && element) {
      element.setSelectionRange(text.length, text.length);
    }
    caretAtEnd.current = false;
  }, [text]);

  const edit = (next: string) => {
    setText(next);
    saveDraft(sessionId, next);
  };

  const recall = (next: number | undefined) => {
    setBack(next);
    edit(next === undefined ? "" : (history[history.length - next] ?? ""));
    caretAtEnd.current = true;
  };

  const send = () => {
    if (disabled || offline || text.trim() === "") return;
    if (onSend(text)) {
      edit("");
      setBack(undefined);
    }
  };

  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Message Claude"
        rows={1}
        value={text}
        disabled={disabled}
        ref={field}
        placeholder="Message Claude"
        // `field-sizing` makes the box as tall as its text, up to the cap.
        className="field-sizing-content max-h-48 min-h-9 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        onChange={(event) => edit(event.target.value)}
        onKeyDown={(event) => {
          if (!phone && onShiftTab && event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            onShiftTab();
            return;
          }
          // Not while an input method is composing (its Enter confirms a character).
          if (event.nativeEvent.isComposing) return;
          if (!phone && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          } else if (!phone && event.key === "Escape" && !event.repeat) {
            if (onInterrupt()) event.preventDefault();
          } else if (
            (event.key === "ArrowUp" || event.key === "ArrowDown") &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            const { selectionStart, selectionEnd } = event.currentTarget;
            if (event.key === "ArrowUp") {
              // Empty box, or a recalled prompt with the caret on its first line.
              const onFirstLine = !text.slice(0, selectionStart).includes("\n");
              if (text === "" && history.length > 0) {
                event.preventDefault();
                recall(1);
              } else if (recalling && onFirstLine) {
                event.preventDefault();
                recall(Math.min((back ?? 0) + 1, history.length));
              }
            } else if (recalling && !text.slice(selectionEnd).includes("\n")) {
              event.preventDefault();
              recall(back === 1 ? undefined : (back ?? 1) - 1);
            }
          }
        }}
      />
      {working && (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Interrupt"
          disabled={disabled || offline || interrupting}
          onClick={() => onInterrupt()}
          // Keeps the keyboard up on a phone: pressing it must not take the focus from the box.
          onMouseDown={(event) => event.preventDefault()}
        >
          <SquareIcon />
        </Button>
      )}
      <Button
        type="submit"
        size="icon"
        aria-label="Send"
        disabled={disabled || offline || text.trim() === ""}
        // Keeps the keyboard up on a phone: pressing Send must not take the focus from the box.
        onMouseDown={(event) => event.preventDefault()}
      >
        <SendIcon />
      </Button>
    </form>
  );
}
