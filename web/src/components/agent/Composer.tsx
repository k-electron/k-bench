import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsPhone } from "@/useIsPhone";

/**
 * The input box under a Claude Agent's conversation. On desktop, Enter sends and Shift+Enter
 * starts a new line. On a phone, Return starts a new line and the Send button sends: there is
 * no Enter to reach for, and an on-screen keyboard's Return is for writing. The box grows
 * with what is typed. It takes no Extra keys and no Smart typing: it is an ordinary field.
 */
export function Composer({
  onSend,
  disabled,
  offline,
  autoFocus,
}: {
  /** Sends the text; false when it could not be sent (reconnecting), and the box keeps it. */
  onSend: (text: string) => boolean;
  /** The Agent has ended: nothing can be sent. */
  disabled: boolean;
  /** The connection is down: the box stays editable, but Send waits for it to come back. */
  offline: boolean;
  autoFocus: boolean;
}) {
  const phone = useIsPhone();
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  // The Focused Pane's box takes the keyboard, as its terminal would. Not on a phone, where
  // focusing raises the on-screen keyboard over the conversation.
  useEffect(() => {
    if (autoFocus && !phone) field.current?.focus();
  }, [autoFocus, phone]);

  const send = () => {
    if (disabled || offline || text.trim() === "") return;
    if (onSend(text)) setText("");
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
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Not while an input method is composing (its Enter confirms a character).
          if (
            !phone &&
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
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
