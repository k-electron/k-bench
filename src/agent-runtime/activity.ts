import type { AgentStatus } from "../shared/agent-protocol.ts";

/** What `Activity` reads of an SDK message: only these fields, so any message can be passed. */
interface MessageShape {
  type?: unknown;
  subtype?: unknown;
  state?: unknown;
}

/** The message types that only a running turn produces (a late `system` message is not one). */
const TURN_MESSAGES = new Set(["stream_event", "assistant", "user", "tool_progress"]);

/**
 * Whether the Agent is Idle, Working or Waiting for you, which is what `status.state` says
 * (ticket #142). Working is a turn running, whoever started it; Waiting is an Allow/Deny ask
 * open, and wins over Working.
 *
 * Where Claude Code says it (`system/session_state_changed`: `running`, `requires_action`,
 * `idle`, which the runtime asks it to emit) that is believed. But it is not relied on: it
 * has not been confirmed to come for a turn nobody sent, such as one `/loop` starts. So a turn
 * is also seen from its messages, from the first one a turn produces until its `result`, and
 * a prompt sent counts as running from the moment it is sent, so that there is no Idle gap
 * between a turn's `result` and the queued prompt behind it.
 *
 * A command that takes no turn and sends no `result` (`/clear`) must not leave a prompt counted
 * as running for ever: `conversation_reset` and Claude Code's `idle` both clear the count.
 */
export class Activity {
  /** Prompts sent whose turn has not ended. */
  private queued = 0;
  /** A turn is running, as Claude Code's own messages show. */
  private turn = false;
  private startedAt: number | undefined;
  private last: AgentStatus | undefined;
  private readonly openAsks: () => number;
  private readonly publish: (status: AgentStatus) => void;
  private readonly now: () => number;

  constructor(options: {
    /** How many Allow/Deny asks are open. */
    openAsks: () => number;
    /** Called with the new status whenever it changes. */
    publish: (status: AgentStatus) => void;
    now?: () => number;
  }) {
    this.openAsks = options.openAsks;
    this.publish = options.publish;
    this.now = options.now ?? Date.now;
  }

  /** The status now. */
  get status(): AgentStatus {
    const state =
      this.openAsks() > 0 ? "waiting" : this.queued > 0 || this.turn ? "working" : "idle";
    if (state === "idle") {
      this.startedAt = undefined;
      return { type: "status", state };
    }
    this.startedAt ??= this.now();
    return { type: "status", state, turnStartedAt: this.startedAt };
  }

  /** A prompt was sent to Claude Code. */
  prompt(): void {
    this.queued += 1;
    this.update();
  }

  /** Claude Code sent this message. */
  message(message: MessageShape): void {
    const { type, subtype } = message;
    if (type === "result") {
      this.queued = Math.max(0, this.queued - 1);
      this.turn = false;
    } else if (type === "conversation_reset") {
      this.queued = 0;
      this.turn = false;
    } else if (type === "system" && subtype === "session_state_changed") {
      if (message.state === "idle") {
        this.queued = 0;
        this.turn = false;
      } else if (message.state === "running" || message.state === "requires_action") {
        this.turn = true;
      }
    } else if (
      (typeof type === "string" && TURN_MESSAGES.has(type)) ||
      (type === "system" && subtype === "init")
    ) {
      this.turn = true;
    }
    this.update();
  }

  /** An ask opened or closed: re-evaluate. */
  asksChanged(): void {
    this.update();
  }

  private update(): void {
    const status = this.status;
    if (
      this.last?.state === status.state &&
      this.last.turnStartedAt === status.turnStartedAt
    ) {
      return;
    }
    this.last = status;
    this.publish(status);
  }
}
