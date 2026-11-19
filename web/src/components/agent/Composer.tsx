import { SendIcon, SquareIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadDraft, saveDraft } from "@/agent/drafts";
import { imageFilesIn } from "@/agent/images";
import { completion } from "@/agent/slashCommands";
import { useAttachments } from "@/agent/useAttachments";
import { Button } from "@/components/ui/button";
import { useIsPhone } from "@/useIsPhone";
import type { AgentCommand } from "../../../../src/shared/agent-protocol.ts";
import { AttachButton, AttachmentStrip } from "./Attachments";
import { PickerMenu } from "./PickerMenu";
import { useCommandMenu } from "./useCommandMenu";
import { useFileMenu } from "./useFileMenu";

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
 * Images are attached by paste, drop or the Attach button (`useAttachments`).
 * Typing `/` opens the commands menu (`useCommandMenu`) and `@` the file picker
 * (`useFileMenu`); each owns the arrow keys while it is open, and so keeps them from stepping
 * through history.
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
  commands,
}: {
  /** The Agent's Session ID: whose draft the box keeps. */
  sessionId: string;
  /**
   * Sends the text and the names of the images attached; false when it could not be sent
   * (reconnecting), and the box keeps both.
   */
  onSend: (text: string, images: string[]) => boolean;
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
  /** What the `/` menu offers (#150). */
  commands: readonly AgentCommand[];
}) {
  const phone = useIsPhone();
  const [text, setText] = useState(() => loadDraft(sessionId));
  /**
   * Which earlier prompt the box shows, counted back from the newest (1 is the newest); none
   * when the box holds what was typed. Editing the recalled text ends the recall.
   */
  const [back, setBack] = useState<number | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Where the caret goes after the next text change that moves it: a place, or the end. */
  const caretTo = useRef<number | "end" | undefined>(undefined);
  /** Where the caret is in `text`, for the `@` picker, which opens by the word it is in. */
  const [caret, setCaret] = useState(text.length);
  const attachments = useAttachments(sessionId);
  const [dropping, setDropping] = useState(false);
  const canSend =
    !disabled &&
    !offline &&
    !attachments.busy &&
    (text.trim() !== "" || attachments.ready.length > 0);

  const recalled = back === undefined ? undefined : history[history.length - back];
  const recalling = recalled !== undefined && text === recalled;
  const commandMenu = useCommandMenu({
    text,
    commands,
    suppressed: disabled || recalling,
    onPick: (command) => {
      // Its name and nothing more: the owner carries on from there.
      edit(completion(command));
      setBack(undefined);
      caretTo.current = "end";
    },
  });
  const fileMenu = useFileMenu({
    sessionId,
    text,
    caret,
    suppressed: disabled || recalling,
    onPick: (picked) => {
      edit(picked.text);
      setBack(undefined);
      caretTo.current = picked.caret;
    },
  });
  // At most one is open: `/` needs the whole text to be the command, `@` a word of its own.
  const menu = fileMenu.open && !commandMenu.open ? fileMenu : commandMenu;
  const menuLabel = menu === fileMenu ? "Files" : "Commands";

  // The Focused Pane's box takes the keyboard, as its terminal would. Not on a phone, where
  // focusing raises the on-screen keyboard over the conversation.
  useEffect(() => {
    if (autoFocus && !phone) field.current?.focus();
  }, [autoFocus, phone]);

  // A recalled prompt leaves the caret at its end, where the owner carries on from.
  useLayoutEffect(() => {
    const element = field.current;
    if (caretTo.current !== undefined && element) {
      const at = caretTo.current === "end" ? text.length : caretTo.current;
      element.setSelectionRange(at, at);
      setCaret(at);
    }
    caretTo.current = undefined;
  }, [text]);

  const edit = (next: string) => {
    setText(next);
    saveDraft(sessionId, next);
  };

  const recall = (next: number | undefined) => {
    setBack(next);
    edit(next === undefined ? "" : (history[history.length - next] ?? ""));
    caretTo.current = "end";
  };

  const send = () => {
    if (!canSend) return;
    if (onSend(text, attachments.ready)) {
      edit("");
      setBack(undefined);
      attachments.clear();
    }
  };

  const attach = (files: File[]) => {
    if (!disabled && files.length > 0) void attachments.add(files);
  };

  return (
    <form
      className={`relative shrink-0 border-t ${dropping ? "bg-accent/40" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        setDropping(false);
        const files = imageFilesIn(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
        attach(files);
      }}
    >
      {menu.open && (
        <PickerMenu
          id={menu.menuId}
          label={menuLabel}
          options={menu.options}
          active={menu.active}
          onPick={menu.pick}
        />
      )}
      <AttachmentStrip
        attached={attachments.attached}
        problems={attachments.problems}
        uploading={attachments.busy}
        onRemove={attachments.remove}
        onDismissProblems={attachments.dismissProblems}
      />
      <div className="flex items-end gap-2 p-2">
        <AttachButton disabled={disabled} onFiles={attach} />
        <textarea
          aria-label="Message Claude"
          rows={1}
          value={text}
          disabled={disabled}
          ref={field}
          placeholder="Message Claude"
          aria-controls={menu.open ? menu.menuId : undefined}
          aria-activedescendant={menu.activeId}
          // `field-sizing` makes the box as tall as its text, up to the cap.
          className="field-sizing-content max-h-48 min-h-9 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          onChange={(event) => {
            edit(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          // The caret moved without a change (an arrow, a tap): the `@` picker follows it.
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onPaste={(event) => {
            // A pasted screenshot is attached; pasted text goes in as it always does.
            const files = imageFilesIn(event.clipboardData);
            if (files.length === 0) return;
            event.preventDefault();
            attach(files);
          }}
          onKeyDown={(event) => {
            if (!phone && onShiftTab && event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              onShiftTab();
              return;
            }
            // Not while an input method is composing (its Enter confirms a character).
            if (event.nativeEvent.isComposing) return;
            if (commandMenu.handleKey(event) || fileMenu.handleKey(event)) return;
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
          disabled={!canSend}
          // Keeps the keyboard up on a phone: pressing Send must not take the focus from the box.
          onMouseDown={(event) => event.preventDefault()}
        >
          <SendIcon />
        </Button>
      </div>
    </form>
  );
}
