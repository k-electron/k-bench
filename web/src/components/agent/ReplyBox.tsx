import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsPhone } from "../../useIsPhone";

/**
 * The box a docked panel opens to ask the owner for words to send back to Claude: a text field
 * with `Send` (needs some text), a plain no (`skipLabel`) and `Back` to the choices. Shared by
 * the permission panel ("No, and tell Claude what to do differently") and the plan panel
 * (feedback on a plan). Enter sends on desktop; on a phone it starts a new line. `disabled`
 * is the panel's `useAnswerGate`.
 */
export function ReplyBox({
  label,
  skipLabel,
  disabled,
  onSend,
  onSkip,
  onBack,
}: {
  /** The field's accessible name and placeholder. */
  label: string;
  /** What the button that answers without words says. */
  skipLabel: string;
  disabled: boolean;
  onSend: (words: string) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [words, setWords] = useState("");
  const phone = useIsPhone();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const send = () => {
    if (words.trim() !== "") onSend(words);
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={field}
        aria-label={label}
        placeholder={label}
        rows={2}
        value={words}
        disabled={disabled}
        className="field-sizing-content max-h-40 min-h-16 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-1.5 font-sans text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        onChange={(event) => setWords(event.target.value)}
        onKeyDown={(event) => {
          // Not while an input method is composing (its Enter confirms a character).
          if (event.nativeEvent.isComposing) return;
          if (!phone && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          disabled={disabled || words.trim() === ""}
          className="h-11 flex-1 sm:h-9"
          onClick={send}
        >
          Send
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          className="h-11 flex-1 sm:h-9"
          onClick={onSkip}
        >
          {skipLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="h-11 flex-1 sm:h-9"
          onClick={onBack}
        >
          Back
        </Button>
      </div>
    </div>
  );
}
