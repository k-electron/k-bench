import type { LogEntry } from "../shared/agent-protocol.ts";

/**
 * Which Claude conversation an Agent is in, read from its log: `/clear` moves it to a new
 * one, and the log stays one continuous file (ADR-0008), so the log is where the answer is.
 *
 * `conversation_reset` does not say which: its `new_conversation_id` is **not** the new
 * session ID (the live check, #121). The new conversation's ID is the `session_id` of the
 * next session-start message, `system/init`. Claude Code sends that with the next turn, so a
 * prompt can come between the two. Until it arrives, the Agent is still in the old one.
 *
 * Claude Code saves a conversation only after its first message, and `--resume` of one never
 * saved fails, so `saved` says whether a resume has anything to find.
 */
export class ConversationTracker {
  private current: string;
  private promptedSinceStart = false;
  /** A reset is waiting for the init that names the new conversation. */
  private resetting = false;
  /** Whether the old conversation was saved, for as long as a reset is waiting. */
  private savedBeforeReset = false;

  /** `initial` is the conversation the Agent was started in (the Session's stored one). */
  constructor(initial: string) {
    this.current = initial;
  }

  /** The conversation the Agent is in now. */
  get id(): string {
    return this.current;
  }

  /** Whether Claude Code has saved the conversation: a prompt was sent in it. */
  get saved(): boolean {
    return this.resetting ? this.savedBeforeReset : this.promptedSinceStart;
  }

  /** Reads the next log entry, in order. True when the conversation changed. */
  observe(entry: LogEntry): boolean {
    // A divider is written only with turns imported from the terminal, so the conversation
    // has been saved there even though k-bench sent nothing in it (#156).
    if (entry.kind === "prompt" || entry.kind === "divider") {
      this.promptedSinceStart = true;
      return false;
    }
    if (entry.kind !== "sdk") return false;
    const { message } = entry;
    if (message.type === "conversation_reset") {
      if (!this.resetting) this.savedBeforeReset = this.promptedSinceStart;
      this.resetting = true;
      this.promptedSinceStart = false;
      return false;
    }
    if (
      this.resetting &&
      message.type === "system" &&
      message.subtype === "init" &&
      typeof message.session_id === "string"
    ) {
      this.resetting = false;
      const changed = message.session_id !== this.current;
      this.current = message.session_id;
      return changed;
    }
    return false;
  }

  /**
   * For a runtime that has read the whole log at its start: a reset still waiting for its
   * init left the Agent in the old conversation, and that is where Claude Code resumes.
   */
  settle(): void {
    if (!this.resetting) return;
    this.resetting = false;
    this.promptedSinceStart = this.savedBeforeReset;
  }
}

/** The conversation `entries` leave an Agent started in `initial` in. */
export function conversationOf(
  initial: string,
  entries: readonly LogEntry[],
): ConversationTracker {
  const tracker = new ConversationTracker(initial);
  for (const entry of entries) tracker.observe(entry);
  tracker.settle();
  return tracker;
}
