import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PermissionAsk } from "../../agent/transcript";

/**
 * The bare Allow/Deny card: which tool Claude wants to use, with its input, and two buttons.
 * Ticket #146 replaces it with Claude Code's own panel (the diff, numbered choices, "don't ask
 * again"); the card's contract stays: it is shown while the ask is open, and goes only when
 * the ask's answered entry arrives, on every device alike.
 *
 * `offline`: the connection is down, so an answer would be dropped; the buttons wait for it
 * to come back, as Send does. A click disables them until the ask ends (a double tap must not
 * answer twice), unless the connection drops meanwhile, when the answer may not have arrived
 * and they are given back.
 */
export function PermissionPrompt({
  ask,
  more,
  offline,
  onAnswer,
}: {
  ask: PermissionAsk;
  /** How many more asks wait behind this one. */
  more: number;
  offline: boolean;
  /** Sends the answer; false when it could not be sent. */
  onAnswer: (requestId: string, decision: "allow" | "deny") => boolean;
}) {
  const [answering, setAnswering] = useState(false);
  // The next ask is a new card: it starts enabled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets when the ask changes
  useEffect(() => setAnswering(false), [ask.requestId]);
  // An answer sent just before the connection dropped may never have arrived.
  useEffect(() => {
    if (offline) setAnswering(false);
  }, [offline]);

  const answer = (decision: "allow" | "deny") => {
    if (offline || answering) return;
    if (onAnswer(ask.requestId, decision)) setAnswering(true);
  };
  const disabled = offline || answering;

  return (
    <section
      aria-label="Permission prompt"
      className="flex shrink-0 flex-col gap-2 border-t p-3 text-sm"
    >
      <p className="font-medium break-words">
        {ask.title ?? `Claude wants to use ${ask.toolName}`}
      </p>
      {ask.description !== undefined && (
        <p className="text-xs break-words text-muted-foreground">{ask.description}</p>
      )}
      <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 text-xs break-words whitespace-pre-wrap">
        {JSON.stringify(ask.input, null, 2)}
      </pre>
      {more > 0 && (
        <p className="text-xs text-muted-foreground">{more} more waiting after this</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          disabled={disabled}
          className="h-11 flex-1 sm:h-9"
          onClick={() => answer("allow")}
        >
          Allow
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          className="h-11 flex-1 sm:h-9"
          onClick={() => answer("deny")}
        >
          Deny
        </Button>
      </div>
    </section>
  );
}
