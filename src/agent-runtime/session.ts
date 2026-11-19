import {
  type AccountInfo,
  type CanUseTool,
  type EffortLevel,
  type ElicitationRequest,
  type PermissionMode,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";

import type { AgentContextUsage } from "../shared/agent-protocol.ts";
import type { LaunchOptions } from "../shared/launch-options.ts";

/** What a `ClaudeSession` tells the runtime about Claude Code. */
export interface SessionHandlers {
  /** Every message Claude Code sent, as the SDK yielded it, in order. */
  message(message: SDKMessage): void;
  /** Claude Code's output ended: it exited, or the SDK failed. `error` is why, if it failed. */
  ended(error: unknown): void;
  /**
   * An MCP server asked the owner for input (an elicitation) and the session declined for
   * them: a Claude Agent has nowhere to show the question (#153). Called before the answer
   * goes to Claude Code.
   */
  elicitationDeclined(request: ElicitationRequest): void;
}

/** What `ClaudeSession` needs to start Claude Code. */
export interface SessionOptions {
  /** The absolute path of the owner's installed `claude`. */
  claude: string;
  /** The folder Claude Code runs in. */
  folder: string;
  /** The conversation: named by `--session-id`, or carried on by `--resume`. */
  conversation: { id: string; resume: boolean };
  /**
   * What Claude Code asks, through the SDK, wherever the owner's permission rules and mode
   * say to ask. Setting it at all matters: it is what makes Claude Code ask the SDK instead
   * of the terminal it does not have. It must wait for as long as the runtime lives (no
   * `defer`): see `PermissionAsks`.
   */
  canUseTool: CanUseTool;
  /** The Session's Launch options: fixed for its life, and passed again at every start. */
  launch: LaunchOptions;
}

/**
 * Launch options as the SDK passes them to Claude Code. Default adds nothing, so the owner's
 * own configuration applies. Everything here is for this launch only and leaves the owner's
 * settings files alone (`settings` is a flag-tier overlay):
 * - Advisor is `--advisor <model>`, **never** the `/advisor <model>` command, which would
 *   overwrite the owner's saved default. Off is `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`, as for
 *   Claude TUI: leaving the flag out is not enough when the owner's settings turn it on.
 * - Focus view is `settings: {viewMode: "focus"}`; Claude Code reports it in each turn's
 *   `system/init` (`view_mode`), which is what the Transcript reads.
 */
export function sdkLaunchOptions(launch: LaunchOptions): {
  model?: string;
  effort?: EffortLevel;
  extraArgs: Record<string, string | null>;
  env: Record<string, string | undefined>;
  settings?: Settings;
} {
  const { model, effort, advisor, focusView } = launch;
  return {
    ...(model === "default" ? {} : { model }),
    ...(effort === "default" ? {} : { effort }),
    extraArgs: {
      "replay-user-messages": null,
      ...(advisor === "default" || advisor === "off" ? {} : { advisor }),
    },
    // The owner's own environment, plus a request that Claude Code report when a turn
    // starts and ends (`session_state_changed`), which `Activity` believes when it comes.
    env: {
      ...process.env,
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
      ...(advisor === "off" ? { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } : {}),
    },
    ...(focusView ? { settings: { viewMode: "focus" } } : {}),
  };
}

/** The messages for Claude Code, as the SDK's streaming input takes them. */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly waiting: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(message: SDKUserMessage): void {
    this.waiting.push(message);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.waiting.length > 0) yield this.waiting.shift() as SDKUserMessage;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

/**
 * The Agent SDK driving the owner's installed `claude`, with everything the spec fixes:
 * the `claude_code` system prompt preset, the default settings sources (so CLAUDE.md,
 * skills, plugins, hooks, MCP servers and permission rules load as in a terminal), partial
 * messages, file checkpointing from the very first launch (it cannot be added later, and the
 * terminal's `/rewind` depends on it) and user messages replayed (`replay-user-messages`),
 * so every prompt comes back with the client-set ID it was sent with.
 *
 * Nothing here knows about the log, the socket or the protocol; the runtime wires those.
 */
export class ClaudeSession {
  private readonly prompts = new PromptQueue();
  private readonly query: Query;

  constructor(options: SessionOptions, handlers: SessionHandlers) {
    const { claude, folder, conversation, canUseTool, launch } = options;
    const claudeQuery = query({
      prompt: this.prompts,
      options: {
        pathToClaudeCodeExecutable: claude,
        cwd: folder,
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        enableFileCheckpointing: true,
        canUseTool,
        // The Transcript gives every subagent and background task a Stop of its own
        // (`stopTask`), so an interrupt must spare them, as the terminal's Esc does: without
        // this Claude Code kills them all, leaving no way to keep one.
        perTaskStopAffordance: true,
        // Left unset, the SDK declines an elicitation by itself and the runtime never hears of
        // it. Set, the same decline is recorded, so the Transcript can say what was asked.
        onElicitation: async (request) => {
          handlers.elicitationDeclined(request);
          return { action: "decline" };
        },
        ...sdkLaunchOptions(launch),
        ...(conversation.resume
          ? { resume: conversation.id }
          : { sessionId: conversation.id }),
      },
    });
    this.query = claudeQuery;
    void (async () => {
      try {
        for await (const message of claudeQuery) handlers.message(message);
        handlers.ended(undefined);
      } catch (error) {
        handlers.ended(error);
      }
    })();
  }

  /** What `claude` says it is, once it has answered the SDK's first request. Rejects if it dies first. */
  async claudeVersion(): Promise<string> {
    const init = await this.query.initializationResult();
    return init.claude_code_version ?? "unknown";
  }

  /** The login Claude Code says it has, from the same first reply. */
  accountInfo(): Promise<AccountInfo> {
    return this.query.accountInfo();
  }

  /**
   * The commands and skills Claude Code lists now (the raw rows: `CommandList` reads them).
   * The SDK keeps the latest list, the first reply's or a later `commands_changed`'s.
   */
  commands(): Promise<unknown> {
    return this.query.supportedCommands();
  }

  /** The mode Claude Code started in (the owner's settings decide it), from the same first reply. */
  async permissionMode(): Promise<unknown> {
    const init = await this.query.initializationResult();
    // Not in the SDK's types, but in what `claude` answers; the caller checks it.
    return (init as { current_permission_mode?: unknown }).current_permission_mode;
  }

  /** Switches Claude Code's permission mode. Rejects if Claude Code refuses. */
  setPermissionMode(mode: PermissionMode): Promise<void> {
    return this.query.setPermissionMode(mode);
  }

  /**
   * How full the context is. Claude Code does not push it, so the runtime asks. Rejects when
   * Claude Code cannot say (an older one answers "unsupported") or has gone: the caller treats
   * that as "nothing to show".
   */
  async contextUsage(): Promise<AgentContextUsage> {
    const usage = await this.query.getContextUsage();
    return {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      isAutoCompactEnabled: usage.isAutoCompactEnabled,
      ...(typeof usage.autoCompactThreshold === "number"
        ? { autoCompactThreshold: usage.autoCompactThreshold }
        : {}),
    };
  }

  /**
   * Sends a prompt as typed. `id` becomes the message's `uuid`, which Claude Code echoes back
   * (the messages are replayed). Never marked as composed by the client, so `@path` expands.
   */
  prompt(id: string, content: SDKUserMessage["message"]["content"]): void {
    this.prompts.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: id as SDKUserMessage["uuid"],
    });
  }

  /**
   * Stops the turn that is running. Prompts waiting are left to run after it, in order (the
   * SDK's plain interrupt does not cancel them). With nothing running it does nothing, so
   * it is always safe to send.
   */
  interrupt(): void {
    this.query.interrupt().catch(() => {
      // Claude Code is gone or refused: `ended` reports the first, and a refusal changes nothing.
    });
  }

  /**
   * Stops one subagent or background task by Claude Code's `task_id`; the turn and the other
   * tasks go on. Claude Code answers with a `task_notification` of status `stopped`. A task
   * that is already gone is refused by Claude Code: that changes nothing, so it is not an error.
   */
  stopTask(taskId: string): void {
    this.query.stopTask(taskId).catch(() => {
      // Already ended, or Claude Code is gone (`ended` reports that).
    });
  }

  /** Ends Claude Code: its input is closed and the process killed. */
  close(): void {
    this.prompts.close();
    this.query.close();
  }
}
