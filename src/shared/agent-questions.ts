import { MAX_QUESTIONS, type QuestionAnswers } from "./agent-protocol.ts";

/**
 * The questions of an AskUserQuestion ask (#147), read from the tool's input as Claude Code
 * sends it: one to four questions, each with a short `header`, two to four options (a `label`
 * and a `description`) and `multiSelect`. The runtime checks an answer against them and the
 * browser draws them, so both read the input the same way.
 */
export interface AskedQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

/** The tool whose ask is a set of questions. */
export const ASK_USER_QUESTION = "AskUserQuestion";

/** The tool whose ask is a plan to approve. */
export const EXIT_PLAN_MODE = "ExitPlanMode";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The questions the input holds, or undefined when it is not what AskUserQuestion sends (a
 * newer Claude Code that changed it): such an ask is shown, and answered, as a plain permission
 * ask rather than guessed at.
 */
export function askedQuestions(input: unknown): AskedQuestion[] | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { questions } = input as { questions?: unknown };
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  if (questions.length > MAX_QUESTIONS) return undefined;
  const asked: AskedQuestion[] = [];
  for (const entry of questions) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const { question, header, options, multiSelect } = entry as Record<string, unknown>;
    const questionText = text(question);
    if (questionText === undefined || !Array.isArray(options)) return undefined;
    const read: AskedQuestion["options"] = [];
    for (const option of options) {
      const label = text((option as { label?: unknown } | null)?.label);
      if (label === undefined) return undefined;
      const description = (option as { description?: unknown }).description;
      read.push({
        label,
        description: typeof description === "string" ? description : "",
      });
    }
    asked.push({
      question: questionText,
      header: typeof header === "string" ? header : "",
      options: read,
      multiSelect: multiSelect === true,
    });
  }
  // The same question twice could not be answered separately: not something to guess at.
  return new Set(asked.map((q) => q.question)).size === asked.length ? asked : undefined;
}

/** Whether `answers` answers every question, and nothing else. */
export function answersFit(
  questions: readonly AskedQuestion[],
  answers: QuestionAnswers,
): boolean {
  const keys = Object.keys(answers);
  return (
    keys.length === questions.length &&
    questions.every((q) => Object.hasOwn(answers, q.question))
  );
}

/** The plan an ExitPlanMode ask holds, or undefined when the input has none. */
export function askedPlan(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  return text((input as { plan?: unknown }).plan);
}
