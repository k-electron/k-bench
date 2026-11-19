import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type {
  NewLogEntry,
  PermissionAnswer,
  PermissionAskEntry,
} from "../shared/agent-protocol.ts";

/** What Claude Code is told when the owner denies, which Claude reads as the tool's error. */
const DENIED_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected " +
  "(eg. if it was a file edit, the new_string was NOT written to the file). " +
  "STOP what you are doing and wait for the user to tell you how to proceed.";

/** An ask Claude Code is waiting on: what it takes to answer it later. */
interface OpenAsk {
  input: Record<string, unknown>;
  toolUseId: string;
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

  constructor(record: (entry: NewLogEntry) => void) {
    this.record = record;
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
      this.open.set(requestId, { input, toolUseId: options.toolUseID, resolve, reject });
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
   * built here from the ask, never taken from the client.
   */
  answer(requestId: string, decision: "allow" | "deny"): void {
    const ask = this.close(requestId, { decision });
    if (!ask) return;
    ask.resolve(
      decision === "allow"
        ? { behavior: "allow", updatedInput: ask.input, toolUseID: ask.toolUseId }
        : { behavior: "deny", message: DENIED_MESSAGE, toolUseID: ask.toolUseId },
    );
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
