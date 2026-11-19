import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { isPermissionMode, type PermissionMode } from "../shared/agent-protocol.ts";

/**
 * The permission mode Claude Code is in, as far as the runtime can tell. Claude Code owns
 * it (the owner's settings start it, plan approval leaves plan mode, a command can change
 * it), so the runtime never assumes: it takes it from what Claude Code says, and from a
 * switch Claude Code accepted. `undefined` until it has said.
 */
export class PermissionModeTracker {
  private mode: PermissionMode | undefined;

  get current(): PermissionMode | undefined {
    return this.mode;
  }

  /** Sets the mode; true when that changed it. */
  set(mode: unknown): boolean {
    if (!isPermissionMode(mode) || mode === this.mode) return false;
    this.mode = mode;
    return true;
  }

  /**
   * Takes the mode a message from Claude Code names, if it names one: a turn's `init` and a
   * `status` both carry it. True when that changed it.
   */
  observe(message: SDKMessage): boolean {
    if (message.type !== "system") return false;
    if (message.subtype === "init" || message.subtype === "status") {
      return this.set((message as { permissionMode?: unknown }).permissionMode);
    }
    return false;
  }
}
