import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadDraft, saveDraft } from "@/agent/drafts";
import { imageFilesIn } from "@/agent/images";
import { useAttachments } from "@/agent/useAttachments";
import { Button } from "@/components/ui/button";
import { useIsPhone } from "@/useIsPhone";
import { AttachButton, AttachmentStrip } from "./Attachments";

/**
 * The input box under a Claude Agent's conversation. On desktop, Enter sends and Shift+Enter
 * starts a new line. On a phone, Return starts a new line and the Send button sends: there is
 * no Enter to reach for, and an on-screen keyboard's Return is for writing. The box grows
 * with what is typed. It takes no Extra keys and no Smart typing: it is an ordinary field.
 * What is typed and not sent is kept as a draft on this device, per Agent, until it is sent.
 * Images are attached by paste, drop or the Attach button (`useAttachments`).
 */
export function Composer({
  sessionId,
  onSend,
  disabled,
  offline,
  autoFocus,
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
}) {
  const phone = useIsPhone();
  const [text, setText] = useState(() => loadDraft(sessionId));
  const field = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(sessionId);
  const [dropping, setDropping] = useState(false);
  const hasContent = text.trim() !== "" || attachments.ready.length > 0;
  const canSend = !disabled && !offline && !attachments.busy && hasContent;

  // The Focused Pane's box takes the keyboard, as its terminal would. Not on a phone, where
  // focusing raises the on-screen keyboard over the conversation.
  useEffect(() => {
    if (autoFocus && !phone) field.current?.focus();
  }, [autoFocus, phone]);

  const edit = (next: string) => {
    setText(next);
    saveDraft(sessionId, next);
  };

  const send = () => {
    if (!canSend) return;
    if (onSend(text, attachments.ready)) {
      edit("");
      attachments.clear();
    }
  };

  const attach = (files: File[]) => {
    if (!disabled && files.length > 0) void attachments.add(files);
  };

  return (
    <form
      className={`shrink-0 border-t ${dropping ? "bg-accent/40" : ""}`}
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
          // `field-sizing` makes the box as tall as its text, up to the cap.
          className="field-sizing-content max-h-48 min-h-9 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          onChange={(event) => edit(event.target.value)}
          onPaste={(event) => {
            // A pasted screenshot is attached; pasted text goes in as it always does.
            const files = imageFilesIn(event.clipboardData);
            if (files.length === 0) return;
            event.preventDefault();
            attach(files);
          }}
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
