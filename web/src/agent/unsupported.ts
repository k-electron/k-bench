/**
 * What a Claude Agent meets that k-bench can't show properly or answer (#153), found in the
 * log's entries. Pure: `buildItems` (`items.ts`) turns each finding into an `Unsupported` row
 * in the place it happened, and #154 reports its `unsupportedKind` to the running list.
 *
 * Three things count:
 * - a message, `system` subtype or content block of a kind the table below does not know
 *   (a newer Claude Code grew something);
 * - a request the runtime declined (a `declined` entry: MCP elicitation);
 * - a command that is not available here: Claude Code's reply says so, or it is terminal-only.
 *
 * The tables are what the browser **recognises**, whether it shows the kind (a later ticket
 * may still give it a line) or deliberately shows nothing (a stream of status changes). A
 * kind a later ticket starts to show stays in its table; a kind in neither is the news this
 * file exists to surface.
 */

/** Why a row is Unsupported: the first part of its `unsupportedKind`. */
export type UnsupportedWhat =
  | "message"
  | "system"
  | "block"
  | "declined"
  | "command"
  | "terminal-command";

/** One unsupported thing: what it is, its name, and what to tell the owner about it. */
export interface Unsupported {
  what: UnsupportedWhat;
  /** The message type, subtype, block type, declined request or command's name. */
  name: string;
  /** In plain words: what Claude tried. */
  summary: string;
}

/**
 * The string #154 counts by: `message:<type>`, `system:<subtype>`, `block:<type>`,
 * `declined:<what>`, `command:</name>` or `terminal-command:</name>`. The same thing happening
 * again is the same kind, whichever Session it is in.
 */
export function unsupportedKind(item: { what: UnsupportedWhat; name: string }): string {
  return `${item.what}:${item.name}`;
}

// ---- What the browser recognises ---------------------------------------------------------

/** Top-level message types (`SDKMessage` of the SDK this was built against, and what Claude Code sends besides). */
const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "assistant",
  "user",
  "result",
  "system",
  "stream_event",
  "tool_progress",
  "tool_use_summary",
  "auth_status",
  "rate_limit_event",
  "prompt_suggestion",
  "conversation_reset",
  "command_lifecycle",
  "active_goal",
  "keep_alive",
]);

/** `system` subtypes. */
const SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  "init",
  "status",
  "session_state_changed",
  "compact_boundary",
  "local_command_output",
  "commands_changed",
  "hook_started",
  "hook_progress",
  "hook_response",
  "task_started",
  "task_progress",
  "task_updated",
  "task_notification",
  "background_tasks_changed",
  "api_retry",
  "informational",
  "notification",
  "plugin_install",
  "permission_denied",
  "elicitation_complete",
  "files_persisted",
  "session_writes_lost",
  "mirror_error",
  "worker_shutting_down",
  "memory_recall",
  "model_refusal_fallback",
  "model_refusal_no_fallback",
  "thinking_tokens",
  "control_request_progress",
]);

/** Content block types of an `assistant` or `user` message. */
const BLOCK_TYPES: ReadonlySet<string> = new Set([
  "text",
  "thinking",
  "redacted_thinking",
  "tool_use",
  "tool_result",
  "server_tool_use",
  "advisor_tool_result",
  "advisor_redacted_result",
  "image",
  "document",
]);

// ---- Reading a message -------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** What Claude Code says when a command cannot run here. */
const UNAVAILABLE = /isn['’]t available in this environment/i;

/** The text of a message's content: a bare string, or its text blocks joined. */
function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isObject(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("\n");
}

/**
 * The reply of a command that is not available here: its name (`/plugin`) and the reply's
 * text, or nothing for any other text. Claude Code may send it as a `local_command_output`
 * message, as the `<local-command-stdout>` of a user message, or as a short assistant
 * message that is only the reply; a longer assistant message that merely says the words is
 * Claude's own prose.
 */
function unavailableCommand(
  message: Record<string, unknown>,
): { name: string; text: string } | undefined {
  let text: string;
  if (message.type === "system" && message.subtype === "local_command_output") {
    text = typeof message.content === "string" ? message.content : "";
  } else if (message.type === "user" && !message.tool_use_result) {
    const inner = isObject(message.message) ? message.message : {};
    text = textOfContent(inner.content);
    if (!text.includes("<local-command-stdout>")) return undefined;
  } else if (message.type === "assistant") {
    const inner = isObject(message.message) ? message.message : {};
    text = textOfContent(inner.content);
    if (!/^\s*\/\S+ isn['’]t available in this environment\.?\s*$/i.test(text)) {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (!UNAVAILABLE.test(text)) return undefined;
  const clean = text.replace(/<\/?local-command-stdout>/g, "").trim();
  return { name: /(\/[\w:.-]+)/.exec(clean)?.[1] ?? "unknown", text: clean };
}

/** `Claude Code replied: "…"`, kept short: the raw view has the rest. */
const quote = (text: string) => (text.length > 200 ? `${text.slice(0, 200)}…` : text);

/**
 * What in an SDK message k-bench does not know: an unknown message type or `system` subtype,
 * unknown content blocks (one finding each, in order), or the reply of a command that is not
 * available here. Empty for the ordinary case. Streamed fragments are never logged, so they
 * never come here.
 */
export function unsupportedInMessage(message: Record<string, unknown>): Unsupported[] {
  const type = typeof message.type === "string" ? message.type : "";
  if (!MESSAGE_TYPES.has(type)) {
    const name = type === "" ? "unknown" : type;
    return [
      {
        what: "message",
        name,
        summary: `Claude Code sent a message of a kind k-bench doesn't know: "${name}".`,
      },
    ];
  }
  if (type === "system") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "";
    if (!SYSTEM_SUBTYPES.has(subtype)) {
      const name = subtype === "" ? "unknown" : subtype;
      return [
        {
          what: "system",
          name,
          summary: `Claude Code sent a notice of a kind k-bench doesn't know: "${name}".`,
        },
      ];
    }
  }
  const found: Unsupported[] = [];
  if (type === "assistant" || type === "user") {
    const inner = isObject(message.message) ? message.message : {};
    const blocks = Array.isArray(inner.content) ? inner.content : [];
    for (const block of blocks) {
      const blockType =
        isObject(block) && typeof block.type === "string" ? block.type : "";
      if (BLOCK_TYPES.has(blockType)) continue;
      const name = blockType === "" ? "unknown" : blockType;
      found.push({
        what: "block",
        name,
        summary: `Claude's message holds a part of a kind k-bench doesn't know: "${name}".`,
      });
    }
  }
  const command = unavailableCommand(message);
  if (command) {
    found.push({
      what: "command",
      name: command.name,
      summary: `${command.name} isn't available here. Claude Code replied: "${quote(command.text)}"`,
    });
  }
  return found;
}

/** What a `declined` entry's request says, in plain words. */
export function unsupportedOfDeclined(request: Record<string, unknown>): Unsupported {
  const server = typeof request.serverName === "string" ? request.serverName : undefined;
  const asked =
    typeof request.message === "string"
      ? request.message
      : typeof request.title === "string"
        ? request.title
        : undefined;
  return {
    what: "declined",
    name: "elicitation",
    summary: `${server ? `The MCP server "${server}"` : "An MCP server"} asked you${asked ? `: "${quote(asked)}"` : " for input"}. k-bench can't show that question, so it declined for you.`,
  };
}

/**
 * The first word of a prompt, when it is a command the Claude Code it went to says is
 * terminal-only (`system/init.terminal_slash_commands`). Claude Code leaves the slash out of
 * some lists and not others: both spellings match.
 */
export function terminalOnlyCommand(
  promptText: string,
  terminalCommands: unknown,
): Unsupported | undefined {
  if (!Array.isArray(terminalCommands)) return undefined;
  const first = /^\s*(\/[\w:.-]+)/.exec(promptText)?.[1];
  if (!first) return undefined;
  const listed = terminalCommands.some(
    (command) =>
      typeof command === "string" && command.replace(/^\//, "") === first.slice(1),
  );
  if (!listed) return undefined;
  return {
    what: "terminal-command",
    name: first,
    summary: `${first} only works in a terminal, so Claude Code can't run it here.`,
  };
}
