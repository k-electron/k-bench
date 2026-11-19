import { type ReactNode, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The parts every docked prompt is made of, shared by the permission panel and (#147) the
 * question and plan panels: the panel's frame, a numbered full-width choice, and the rule for
 * when an answer may be sent.
 */

/**
 * Whether the choices of the ask `requestId` can be used. They wait while the connection is
 * down (`offline`: an answer would be dropped), and after one is sent until the ask ends (a
 * double tap must not answer twice), unless the connection drops meanwhile, when the answer
 * may not have arrived and they are given back.
 */
export function useAnswerGate(requestId: string, offline: boolean) {
  const [answering, setAnswering] = useState(false);
  // The next ask is a new panel: it starts enabled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets when the ask changes
  useEffect(() => setAnswering(false), [requestId]);
  // An answer sent just before the connection dropped may never have arrived.
  useEffect(() => {
    if (offline) setAnswering(false);
  }, [offline]);
  return {
    disabled: offline || answering,
    /** Runs `send` (which returns whether the answer went out) unless the choices wait. */
    answer(send: () => boolean) {
      if (offline || answering) return;
      if (send()) setAnswering(true);
    },
  };
}

/**
 * The panel docked under the conversation while Claude waits on the owner: a titled region,
 * scrolling inside itself when it is tall so the choices stay in reach on a phone. `more` is
 * how many asks wait behind this one.
 */
export function AskPanel({
  label,
  more,
  children,
}: {
  /** The region's accessible name. */
  label: string;
  more: number;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex max-h-[70dvh] shrink-0 flex-col gap-2 overflow-y-auto border-t-2 border-orange-400/70 bg-orange-400/5 p-3 font-mono text-[13px]"
    >
      {children}
      {more > 0 && (
        <p className="text-xs text-muted-foreground">{more} more waiting after this</p>
      )}
    </section>
  );
}

/**
 * One numbered, full-width choice: `1. Yes`. With `selected` it is a toggle (`aria-pressed`), as
 * the options of a question are; `description` is Claude's note under the option, read as its
 * description, not as part of its name.
 */
export function Choice({
  number,
  disabled,
  selected,
  description,
  onClick,
  children,
}: {
  number: number;
  disabled: boolean;
  selected?: boolean;
  description?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-labelledby={`${id}-name`}
      aria-describedby={description ? `${id}-description` : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full flex-col items-start justify-center rounded px-2 py-1.5 text-left hover:bg-white/10 active:bg-white/15 disabled:opacity-50 sm:min-h-9",
        selected && "bg-white/10 ring-1 ring-orange-300/70",
      )}
    >
      <span id={`${id}-name`}>
        {number}. {children}
      </span>
      {description && (
        <span
          id={`${id}-description`}
          className="pl-5 text-xs break-words text-muted-foreground"
        >
          {description}
        </span>
      )}
    </button>
  );
}
