import type { SessionState } from "../../../src/shared/state-protocol.ts";

/**
 * What Open in terminal would end in a running Claude Agent, one line each; empty when
 * nothing would be lost, so it goes ahead without asking. A Stopped Agent has nothing running,
 * and one whose runtime has not been heard from yet is treated as Stop treats it: nothing.
 */
export function whatWouldStop(session: SessionState): string[] {
  const agent = session.status === "running" ? session.agent : undefined;
  if (!agent) return [];
  const lines: string[] = [];
  if (agent.state === "working") {
    lines.push("Claude is working. The turn that is running is interrupted.");
  } else if (agent.state === "waiting") {
    lines.push("Claude is waiting for you. The open prompt is marked as not answered.");
  }
  for (const task of agent.tasks ?? []) {
    lines.push(
      `${task.kind === "subagent" ? "Subagent" : "Background task"}: ${task.description}`,
    );
  }
  return lines;
}
