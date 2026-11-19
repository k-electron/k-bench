import type { AgentContextUsage } from "../../../src/shared/agent-protocol.ts";
import type { TranscriptItem } from "./items";
import { toolDisplayName } from "./toolDisplay";

/**
 * What Claude is doing right now, for the status line, read from the end of the conversation:
 * thinking, running a tool, writing a reply, or just working (a prompt sent and nothing back
 * yet). Claude Code's terminal has its own cheerful verbs; these say what is actually happening.
 */
export function currentActivity(items: readonly TranscriptItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    switch (item.kind) {
      case "thinking":
        return item.streaming ? "Thinking" : "Working";
      case "assistant":
        return item.streaming ? "Writing" : "Working";
      case "tool":
        return item.status === "running"
          ? `Running ${toolDisplayName(item.name)}`
          : "Working";
      case "advisor":
        return item.status === "consulting" ? "Consulting the advisor" : "Working";
      case "compaction":
        return item.state === "running" ? "Compacting" : "Working";
      default:
        return "Working";
    }
  }
  return "Working";
}

/**
 * How much context is left before Claude Code compacts the conversation by itself, as a
 * percentage as the terminal shows it ("Context left until auto-compact: 12%"): what is left of
 * the size at which it compacts. Undefined when Claude Code cannot say, or does not compact.
 * Kept here, apart from the runtime, so that a wrong reading is a display fix.
 */
export function contextLeftPercent(
  context: AgentContextUsage | undefined,
): number | undefined {
  if (!context?.isAutoCompactEnabled) return undefined;
  const threshold = context.autoCompactThreshold;
  if (threshold === undefined || threshold <= 0) return undefined;
  const left = ((threshold - context.totalTokens) / threshold) * 100;
  return Math.min(100, Math.max(0, Math.round(left)));
}

/**
 * Whole seconds from `startedAt` to `now`, never negative: the phone's clock and the Host's can
 * differ, and a turn must not read as starting in the future.
 */
export function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
