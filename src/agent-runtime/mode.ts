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
  /** The mode before plan mode was entered: where approving the plan returns to. */
  private beforePlan: PermissionMode | undefined;
  /** The ExitPlanMode tool calls whose plan the owner approved and whose result has not come yet. */
  private readonly approved = new Set<string>();

  get current(): PermissionMode | undefined {
    return this.mode;
  }

  /** Sets the mode; true when that changed it. */
  set(mode: unknown): boolean {
    if (!isPermissionMode(mode) || mode === this.mode) return false;
    if (mode === "plan" && this.mode !== undefined) this.beforePlan = this.mode;
    this.mode = mode;
    return true;
  }

  /** The owner approved the plan of this ExitPlanMode tool call. */
  planApproved(toolUseId: string): void {
    this.approved.add(toolUseId);
  }

  /**
   * Called with each message from Claude Code. When it is the result of an approved plan's
   * ExitPlanMode, Claude Code has left plan mode by now. Whether it says so in a `status` is
   * not known, so if the runtime still thinks it is in plan mode, this is the mode to set so
   * that the mode line is right: the one before plan mode, or `default` when that is not known
   * (the runtime started in plan mode). Undefined when there is nothing to do.
   */
  afterPlan(message: SDKMessage): PermissionMode | undefined {
    if (this.approved.size === 0 || message.type !== "user") return undefined;
    const content = (message.message as { content?: unknown }).content;
    if (!Array.isArray(content)) return undefined;
    for (const block of content as { type?: string; tool_use_id?: string }[]) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue;
      if (!this.approved.delete(block.tool_use_id)) continue;
      if (this.mode === "plan") return this.beforePlan ?? "default";
    }
    return undefined;
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
