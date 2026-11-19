import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  NewLogEntry,
  PermissionAnswer,
  PermissionAskEntry,
  PermissionReply,
} from "../shared/agent-protocol.ts";
import {
  ASK_USER_QUESTION,
  answersFit,
  askedQuestions,
  EXIT_PLAN_MODE,
} from "../shared/agent-questions.ts";

/** What Claude Code is told when the owner denies, which Claude reads as the tool's error. */
const DENIED_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected " +
  "(eg. if it was a file edit, the new_string was NOT written to the file). " +
  "STOP what you are doing and wait for the user to tell you how to proceed.";

/**
 * What Claude Code is told when the owner denies and says why: the same sentence, then the
 * owner's words, which Claude reads as how to proceed.
 */
const DENIED_WITH_REPLY =
  "The user doesn't want to proceed with this tool use. The tool use was rejected " +
  "(eg. if it was a file edit, the new_string was NOT written to the file). " +
  "To tell you how to proceed, the user said:\n";

/** An ask Claude Code is waiting on: what it takes to answer it later. */
interface OpenAsk {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  /** The rule changes Claude Code suggested for "don't ask again"; none if it offered none. */
  suggestions: PermissionUpdate[];
  resolve(result: PermissionResult): void;
  reject(error: Error): void;
}

/**
 * The permission asks Claude Code has made and nobody has answered, the one place that holds
 * them (ADR-0008). Claude Code asks through the SDK's `canUseTool`, which it does only where
 * the owner's own permission rules and mode say to, so the Agent asks exactly when a terminal
 * would. Each ask:
 *
 * - is logged as `permission_asked` (so it shows again on reopen, on every device, and is
 *   still there for a client that connects later),
 * - **waits for as long as the runtime lives, whoever is connected**: there is no timeout and
 *   no `defer`, which would hand the ask back to Claude Code and end the turn,
 * - ends with exactly one `permission_answered`, logged *before* Claude Code hears the answer
 *   so that the log reads in the order things happened: the first `answer` for it wins and a
 *   later one finds nothing open and is ignored; Claude Code withdrawing it (`cancelled`); or
 *   the runtime ending (`interrupted`).
 *
 * Knows nothing of the socket or the SDK's `query`: `record` is how it writes the log.
 */
export class PermissionAsks {
  private readonly open = new Map<string, OpenAsk>();
  private readonly record: (entry: NewLogEntry) => void;
  private readonly planApproved: (toolUseId: string) => void;

  /**
   * `planApproved` hears of a plan the owner approved (an allowed ExitPlanMode), with the id of
   * its tool call: Claude Code leaves plan mode then, and the runtime keeps the mode line
   * right ([Permission mode](../../docs/internals/agent.md)).
   */
  constructor(
    record: (entry: NewLogEntry) => void,
    planApproved: (toolUseId: string) => void = () => {},
  ) {
    this.record = record;
    this.planApproved = planApproved;
  }

  /** How many asks are open: what #142's Waiting state is. */
  get count(): number {
    return this.open.size;
  }

  /** The SDK's permission callback: pass it as `canUseTool`. */
  readonly canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve, reject) => {
      const { requestId, signal } = options;
      if (signal.aborted) {
        reject(new Error("The ask was cancelled"));
        return;
      }
      const known = this.open.has(requestId);
      this.open.set(requestId, {
        toolName,
        input,
        toolUseId: options.toolUseID,
        // "Don't ask again" is offered only where Claude Code offers it.
        suggestions: options.suppressAlwaysAllowRule ? [] : (options.suggestions ?? []),
        resolve,
        reject,
      });
      signal.addEventListener(
        "abort",
        () => {
          // Claude Code withdrew it: nobody can answer it now.
          const withdrawn = this.close(requestId, { decision: "cancelled" });
          withdrawn?.reject(new Error("The ask was cancelled"));
        },
        { once: true },
      );
      if (known) return; // Claude Code asked again: the card is already there.
      const asked: Omit<PermissionAskEntry, "seq" | "t"> = {
        kind: "permission_asked",
        requestId,
        toolName,
        input,
        toolUseId: options.toolUseID,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        blockedPath: options.blockedPath,
        decisionReason: options.decisionReason,
        suggestions: options.suggestions,
        suppressAlwaysAllowRule: options.suppressAlwaysAllowRule,
        defaultToNo: options.defaultToNo,
        agentId: options.agentID,
      };
      this.record(asked);
    });

  /**
   * The owner's answer. The first for an ask wins; an ask that is not open (answered
   * already, withdrawn, never made) is ignored without a word. What Claude Code is sent is
   * built here from the ask, never taken from the client: "don't ask again" sends back the
   * rule changes Claude Code itself suggested, and only if it did.
   */
  answer(requestId: string, reply: PermissionReply): void {
    const ask = this.open.get(requestId);
    if (!ask) return;
    if (reply.decision === "allow") {
      const questions =
        ask.toolName === ASK_USER_QUESTION ? askedQuestions(ask.input) : undefined;
      if (questions) {
        // The answers must be to these questions, all of them: anything else is not an
        // answer, and the ask stays open for a proper one.
        const { answers } = reply;
        if (!answers || !answersFit(questions, answers)) return;
        this.close(requestId, { decision: "allow", answers });
        ask.resolve({
          behavior: "allow",
          updatedInput: { ...ask.input, answers },
          toolUseID: ask.toolUseId,
        });
        return;
      }
      // Answers to an ask that has no questions are not an answer either.
      if (reply.answers) return;
      const always = reply.alwaysAllow === true && ask.suggestions.length > 0;
      this.close(
        requestId,
        always ? { decision: "allow", alwaysAllow: true } : { decision: "allow" },
      );
      ask.resolve({
        behavior: "allow",
        updatedInput: ask.input,
        toolUseID: ask.toolUseId,
        ...(always && { updatedPermissions: ask.suggestions }),
      });
      if (ask.toolName === EXIT_PLAN_MODE) this.planApproved(ask.toolUseId);
      return;
    }
    const said = reply.message?.trim() ?? "";
    this.close(
      requestId,
      said === "" ? { decision: "deny" } : { decision: "deny", message: said },
    );
    ask.resolve({
      behavior: "deny",
      message: said === "" ? DENIED_MESSAGE : DENIED_WITH_REPLY + said,
      toolUseID: ask.toolUseId,
    });
  }

  /** The runtime is ending: every ask still open ends as not answered. */
  interruptAll(): void {
    for (const requestId of [...this.open.keys()]) {
      this.close(requestId, { decision: "interrupted" });
    }
  }

  /** Takes the ask out of the open ones and logs how it ended; undefined if it was not open. */
  private close(requestId: string, answer: PermissionAnswer): OpenAsk | undefined {
    const ask = this.open.get(requestId);
    if (!ask) return undefined;
    this.open.delete(requestId);
    this.record({ kind: "permission_answered", requestId, answer });
    return ask;
  }
}
