/**
 * How a `sync` and a `page` are answered from a log. The one definition: the runtime answers
 * with it while the Agent runs, and the server with the same code, from the log on disk,
 * while the Agent is Stopped, so a Stopped Transcript is exactly what the Agent showed
 * (ADR-0008).
 */

import type {
  AgentClientMessage,
  AgentPage,
  AgentReplay,
} from "../shared/agent-protocol.ts";
import type { AgentLogReader } from "./log.ts";

/**
 * The replay a `sync` asks for: the latest turns for a client that holds nothing and asked
 * for them, else everything after `afterSeq`.
 */
export function answerSync(
  log: AgentLogReader,
  message: Extract<AgentClientMessage, { type: "sync" }>,
): AgentReplay {
  if (message.tailTurns !== undefined && message.afterSeq === 0) {
    return { type: "replay", ...log.readTail(message.tailTurns) };
  }
  return {
    type: "replay",
    from: message.afterSeq + 1,
    entries: log.readAfter(message.afterSeq),
  };
}

/** The page of older turns a `page` asks for. */
export function answerPage(
  log: AgentLogReader,
  message: Extract<AgentClientMessage, { type: "page" }>,
): AgentPage {
  return {
    type: "page",
    beforeSeq: message.beforeSeq,
    ...log.readPage(message.beforeSeq, message.limit),
  };
}
