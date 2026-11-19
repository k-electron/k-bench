import type { LogEntry } from "../../../src/shared/agent-protocol.ts";
import type { TranscriptItem } from "./items";

/**
 * `/goal` in the Transcript (#152). Claude Code answers `/goal <condition>` with a synthetic
 * assistant line ("Goal set: ...") and then, each time its Stop hook finds the condition not yet
 * met, re-prompts itself with a user message that starts "Stop hook feedback:". All of it happens
 * inside one turn. Those re-prompts are not the owner's: they show as goal check-ins, whatever
 * flags (`isReplay`, `isSynthetic`) the message carries.
 *
 * `/loop` needs nothing here: the turns it starts by itself are ordinary messages, which show
 * like any turn, and the runtime counts them as Working and raises the Bell (docs/internals/
 * agent.md, State).
 */

/** `◎ Goal set: <condition>`. */
export interface GoalSetItem {
  kind: "goal-set";
  key: string;
  seq?: number;
  /** The condition, without the "Goal set:" prefix. */
  condition: string;
}

/** `⎿ Goal check-in: <what the Stop hook said>`. */
export interface GoalCheckInItem {
  kind: "goal-check-in";
  key: string;
  seq?: number;
  /** What the Stop hook told Claude, without the "Stop hook feedback:" prefix. */
  feedback: string;
}

export type GoalItem = GoalSetItem | GoalCheckInItem;

/** What a reader needs of `buildItems`'s state. */
export interface GoalHost {
  items: TranscriptItem[];
}

const FEEDBACK_PREFIX = "Stop hook feedback:";
const GOAL_SET_PREFIX = "Goal set:";
/** The model name Claude Code gives the messages it writes itself. */
const SYNTHETIC_MODEL = "<synthetic>";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The text of a message's content (a bare string, or its text blocks). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isObject(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("\n");
}

/**
 * Reads a top-level SDK message that is part of `/goal`: true when it is, and `items.ts` has
 * nothing more to do with it. Everything else is left alone, a user message that is a tool
 * result included.
 */
export function readGoalMessage(
  host: GoalHost,
  entry: Extract<LogEntry, { kind: "sdk" }>,
): boolean {
  const { message } = entry;
  const inner = isObject(message.message) ? message.message : {};
  if (message.type === "user") {
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    if (blocks.some((block) => isObject(block) && block.type === "tool_result")) {
      return false;
    }
    const text = textOf(inner.content).trimStart();
    if (!text.startsWith(FEEDBACK_PREFIX)) return false;
    host.items.push({
      kind: "goal-check-in",
      key: `entry-${entry.seq}`,
      seq: entry.seq,
      feedback: text.slice(FEEDBACK_PREFIX.length).trim(),
    });
    return true;
  }
  if (message.type === "assistant" && inner.model === SYNTHETIC_MODEL) {
    const text = textOf(inner.content).trimStart();
    if (!text.startsWith(GOAL_SET_PREFIX)) return false;
    host.items.push({
      kind: "goal-set",
      key: `entry-${entry.seq}`,
      seq: entry.seq,
      condition: text.slice(GOAL_SET_PREFIX.length).trim(),
    });
    return true;
  }
  return false;
}
