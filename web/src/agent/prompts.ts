import type { LogEntry } from "../../../src/shared/agent-protocol.ts";

/**
 * What the Agent's log says about the prompts the owner sent: which ones Claude Code has not
 * picked up yet, and what was typed before. Pure, and built from the log alone, so every
 * device shows the same.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The prompt IDs an SDK message says Claude Code has taken up. Any one of these is enough,
 * because which of them Claude Code sends depends on what it was doing when the prompt came
 * (docs/internals/agent.md, "Queued prompts"):
 * - `command_lifecycle` for the prompt's `uuid`, in any state but `queued`: its turn began
 *   (or it was withdrawn: it will not run, so it is not waiting either);
 * - the replayed `user` message, which Claude Code sends when it starts the prompt's turn;
 * - the prompt's `uuid` among `user_message_uuid`/`user_message_uuids`, stamped on the reply
 *   frames, which is how a message folded into a running turn between tool rounds shows up.
 */
function pickedUp(message: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (
    message.type === "command_lifecycle" &&
    message.state !== "queued" &&
    typeof message.command_uuid === "string"
  ) {
    ids.push(message.command_uuid);
  }
  if (message.type === "user" && message.isReplay === true) {
    if (typeof message.uuid === "string") ids.push(message.uuid);
  }
  if (typeof message.user_message_uuid === "string") ids.push(message.user_message_uuid);
  if (Array.isArray(message.user_message_uuids)) {
    for (const id of message.user_message_uuids) if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/**
 * The IDs of the prompts that are sent but not yet picked up by Claude Code: the ones shown
 * "(queued)". A prompt is waiting from its `prompt` entry until Claude Code says it took it
 * up. A `runtime` entry ends the wait of every prompt before it: the runtime that held them
 * is gone, so they will never be picked up, and "(queued)" would be a lie.
 */
export function queuedPromptIds(entries: readonly LogEntry[]): ReadonlySet<string> {
  const waiting = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "prompt") {
      waiting.add(entry.id);
    } else if (entry.kind === "runtime") {
      waiting.clear();
    } else if (entry.kind === "sdk" && isObject(entry.message)) {
      for (const id of pickedUp(entry.message)) waiting.delete(id);
    }
  }
  return waiting;
}

/**
 * The prompts typed in this Agent, oldest first, for Up and Down in the input. A prompt
 * repeated straight away counts once, as in a terminal's history.
 */
export function promptHistory(entries: readonly LogEntry[]): string[] {
  const history: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "prompt" && history.at(-1) !== entry.text) {
      history.push(entry.text);
    }
  }
  return history;
}
