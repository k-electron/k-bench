import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  PermissionReply,
  QuestionAnswers,
} from "../../../../src/shared/agent-protocol.ts";
import type { AskedQuestion } from "../../../../src/shared/agent-questions.ts";
import type { PermissionAsk } from "../../agent/transcript";
import { AskPanel, Choice, useAnswerGate } from "./AskPanel";

/** What the owner has picked for one question so far. */
interface Picked {
  /** The labels of the options chosen. */
  labels: ReadonlySet<string>;
  /** The owner's own words, once "Other" is chosen (empty until they are typed). */
  other: string | undefined;
}

const NOTHING: Picked = { labels: new Set(), other: undefined };

/** The answer to one question: the chosen labels in the options' order, then the owner's words. */
function answerTo(question: AskedQuestion, picked: Picked): string {
  const chosen = question.options
    .map((option) => option.label)
    .filter((label) => picked.labels.has(label));
  const words = picked.other?.trim();
  return [...chosen, ...(words ? [words] : [])].join(", ");
}

/**
 * The docked panel for Claude's questions (#147): its `AskUserQuestion` ask, one to four
 * questions with their options, single or multiple choice as Claude asked, and always an
 * "Other" for the owner's own words, as in the terminal. A single question with one answer
 * is answered by choosing it; otherwise the choices are toggles and `Submit` sends them once
 * every question has an answer. `Skip the questions` declines, and Claude goes on without.
 *
 * Gone only when the ask's answered entry arrives, on every device alike. The answer is a
 * `PermissionReply` with `answers`, which the runtime checks against the questions it holds.
 * See `PermissionPrompt` for `offline`.
 */
export function QuestionPrompt({
  ask,
  questions,
  more,
  offline,
  onAnswer,
}: {
  ask: PermissionAsk;
  questions: readonly AskedQuestion[];
  /** How many more asks wait behind this one. */
  more: number;
  offline: boolean;
  /** Sends the answer; false when it could not be sent. */
  onAnswer: (requestId: string, reply: PermissionReply) => boolean;
}) {
  const gate = useAnswerGate(ask.requestId, offline);
  const [picked, setPicked] = useState<readonly Picked[]>(() =>
    questions.map(() => NOTHING),
  );
  const only = questions.length === 1 ? questions[0] : undefined;
  // Choosing an option is the answer when there is nothing else to decide.
  const immediate = only !== undefined && !only.multiSelect;

  const answers = (from: readonly Picked[]): QuestionAnswers | undefined => {
    const all: QuestionAnswers = {};
    for (const [index, question] of questions.entries()) {
      const text = answerTo(question, from[index] ?? NOTHING);
      if (text === "") return undefined;
      all[question.question] = text;
    }
    return all;
  };
  const submit = (from: readonly Picked[]) => {
    const complete = answers(from);
    if (complete) {
      gate.answer(() =>
        onAnswer(ask.requestId, { decision: "allow", answers: complete }),
      );
    }
  };
  const change = (index: number, next: Picked): readonly Picked[] => {
    const updated = picked.map((p, i) => (i === index ? next : p));
    setPicked(updated);
    return updated;
  };

  const choose = (index: number, question: AskedQuestion, label: string) => {
    const now = picked[index] ?? NOTHING;
    if (question.multiSelect) {
      const labels = new Set(now.labels);
      if (!labels.delete(label)) labels.add(label);
      change(index, { ...now, labels });
      return;
    }
    const updated = change(index, { labels: new Set([label]), other: undefined });
    if (immediate) submit(updated);
  };
  const toggleOther = (index: number, question: AskedQuestion) => {
    const now = picked[index] ?? NOTHING;
    if (now.other !== undefined) {
      change(index, { ...now, other: undefined });
    } else {
      change(index, {
        labels: question.multiSelect ? now.labels : new Set(),
        other: "",
      });
    }
  };

  const showSubmit = !immediate || picked[0]?.other !== undefined;
  return (
    <AskPanel label="Question from Claude" more={more}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(picked);
        }}
      >
        {questions.map((question, index) => {
          const now = picked[index] ?? NOTHING;
          const subject = question.header || question.question;
          return (
            <fieldset
              key={question.question}
              aria-label={question.question}
              className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
            >
              <p className="break-words">
                {question.header && (
                  <span className="mr-2 rounded bg-orange-400/20 px-1.5 py-0.5 text-xs text-orange-300">
                    {question.header}
                  </span>
                )}
                <strong>{question.question}</strong>
                {question.multiSelect && (
                  <span className="text-xs text-muted-foreground"> (choose any)</span>
                )}
              </p>
              {question.options.map((option, at) => (
                <Choice
                  key={option.label}
                  number={at + 1}
                  disabled={gate.disabled}
                  selected={now.labels.has(option.label)}
                  {...(option.description && { description: option.description })}
                  onClick={() => choose(index, question, option.label)}
                >
                  {option.label}
                </Choice>
              ))}
              <Choice
                number={question.options.length + 1}
                disabled={gate.disabled}
                selected={now.other !== undefined}
                onClick={() => toggleOther(index, question)}
              >
                Other
              </Choice>
              {now.other !== undefined && (
                <input
                  type="text"
                  // biome-ignore lint/a11y/noAutofocus: the owner just chose to type their own answer
                  autoFocus
                  aria-label={`Your own answer: ${subject}`}
                  placeholder="Your own answer"
                  value={now.other}
                  disabled={gate.disabled}
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 font-sans text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 sm:h-9"
                  onChange={(event) =>
                    change(index, { ...now, other: event.target.value })
                  }
                />
              )}
            </fieldset>
          );
        })}
        <div className="flex flex-col gap-2 sm:flex-row">
          {showSubmit && (
            <Button
              type="submit"
              disabled={gate.disabled || answers(picked) === undefined}
              className="h-11 flex-1 sm:h-9"
            >
              Submit
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={gate.disabled}
            className="h-11 flex-1 sm:h-9"
            onClick={() =>
              gate.answer(() => onAnswer(ask.requestId, { decision: "deny" }))
            }
          >
            Skip the questions
          </Button>
        </div>
      </form>
    </AskPanel>
  );
}
