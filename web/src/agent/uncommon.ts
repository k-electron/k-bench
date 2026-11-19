import type { LogEntry } from "../../../src/shared/agent-protocol.ts";
import type { TranscriptItem } from "./items";

/**
 * The less common lines of the Transcript (#148): compaction, hook output, MCP activity,
 * errors and usage limits, the advisor, the task list, and notices (a folder trust warning
 * among them). Kept apart from `items.ts` so that those stay short; `items.ts` calls
 * `readUncommonMessage` for every top-level SDK message and `readUncommonBlock` for every
 * content block of an assistant message, and both say whether they **handled** it.
 *
 * "Handled" is the contract the Unsupported row (#153) builds on: it fires only for what no
 * reader handled. A message handled and shown nothing for (a hook that ran silently, a rate
 * limit that is fine) is still handled: the silence is a decision made here.
 *
 * Every item sets `seq` from the entry it comes from (what the Raw view shows for it). A line
 * built from several entries sets the one the owner would call "the message": the advice for
 * an advisor, the latest list for the task list.
 */

interface ItemBase {
  key: string;
  seq?: number;
}

/** `✻ Conversation compacted (auto, 168k to 12k tokens)`. */
export interface CompactionItem extends ItemBase {
  kind: "compaction";
  state: "running" | "done" | "failed";
  /** From `compact_boundary`: absent until it arrives. */
  trigger?: "manual" | "auto";
  tokensBefore?: number;
  tokensAfter?: number;
  /** Why it failed, when Claude Code said. */
  error?: string;
}

/** A hook's output: `⏺ SessionStart:startup hook` and what it printed under `⎿`. */
export interface HookItem extends ItemBase {
  kind: "hook";
  /** `SessionStart:startup`, `PreToolUse:Bash`. */
  name: string;
  outcome: "success" | "error" | "cancelled";
  /** What it printed, readable (terminal control sequences removed). */
  lines: string[];
}

/** MCP servers that need attention, or are back: `⎿ MCP: figma needs sign-in`. */
export interface McpItem extends ItemBase {
  kind: "mcp";
  lines: Array<{ text: string; tone: "problem" | "ok" }>;
}

/** An error, a usage limit or a retry, in Claude Code's words. */
export interface ProblemItem extends ItemBase {
  kind: "problem";
  tone: "error" | "limit" | "retry";
  text: string;
  /** When a usage limit lifts, as an epoch in seconds, when Claude Code said. */
  resetsAt?: number;
}

/** Something Claude Code says that is not part of the conversation: a hook's warning, a folder trust warning. */
export interface NoticeItem extends ItemBase {
  kind: "notice";
  tone: "notice" | "warning";
  text: string;
}

/** One consultation of the advisor. The advice may be encrypted: it is a line either way. */
export interface AdvisorItem extends ItemBase {
  kind: "advisor";
  toolUseId: string;
  status: "consulting" | "advice" | "encrypted" | "error";
  /** The advice, when it is not encrypted. */
  text?: string;
  /** Why it could not advise (`overloaded`, `max_uses_exceeded`...). */
  errorCode?: string;
}

export type TodoStatus = "pending" | "in_progress" | "completed";

/** Claude's task list (`TodoWrite`) as a checklist; a later list changes it in place. */
export interface TodosItem extends ItemBase {
  kind: "todos";
  todos: Array<{ content: string; activeForm: string; status: TodoStatus }>;
}

export type UncommonItem =
  | CompactionItem
  | HookItem
  | McpItem
  | ProblemItem
  | NoticeItem
  | AdvisorItem
  | TodosItem;

/** What the readers carry from entry to entry; one per `buildItems` pass. */
export interface UncommonState {
  advisors: Map<string, AdvisorItem>;
  /** The task list now shown, while it has anything left to do. */
  todos?: TodosItem;
  /** The latest compaction, until its `compact_boundary` has filled it in. */
  compaction?: CompactionItem;
  /** MCP servers last reported as needing attention, by name. */
  mcpProblems: Map<string, string>;
  /** The usage-limit line of this turn, so that the two messages that say it make one line. */
  limit?: ProblemItem;
  /** The retry line, updated while it is the last line. */
  retry?: ProblemItem;
  /** Text of the error lines of this turn, so that the result that repeats it adds nothing. */
  problemTexts: Set<string>;
  /** The turn was interrupted: its `result` is the interrupt, not an error. */
  interrupted: boolean;
}

export function newUncommonState(): UncommonState {
  return {
    advisors: new Map(),
    mcpProblems: new Map(),
    problemTexts: new Set(),
    interrupted: false,
  };
}

/** What a reader needs of `buildItems`'s state. */
export interface UncommonHost {
  items: TranscriptItem[];
  uncommon: UncommonState;
}

type SdkEntry = Extract<LogEntry, { kind: "sdk" }>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// Terminal control sequences in a hook's output are not shown: an OSC (`ESC ] ... BEL`, which
// notification plugins print), a CSI (colours), any other escape, and the other control
// characters but newline and tab.
/* biome-ignore-start lint/suspicious/noControlCharactersInRegex: that is what they are */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ESCAPE = /\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
/* biome-ignore-end lint/suspicious/noControlCharactersInRegex: that is what they are */

function printable(text: string): string {
  return text
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(ESCAPE, "")
    .replace(/\r/g, "")
    .replace(CONTROL, "");
}

function toLines(text: string): string[] {
  const lines = printable(text).split("\n");
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return lines;
}

/**
 * What a hook printed, to read. A hook that answers in JSON (Claude Code's hook protocol) is
 * shown by its `systemMessage`, the one field meant for the owner; the rest of it (context for
 * Claude, a terminal sequence) is not for reading. Anything else is shown as it is.
 */
function hookLines(message: Record<string, unknown>): string[] {
  const out = str(message.stdout);
  const err = str(message.stderr);
  const whole = out === undefined && err === undefined ? str(message.output) : undefined;
  const lines: string[] = [];
  for (const part of [out ?? whole, err]) {
    if (part === undefined) continue;
    const trimmed = part.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isObject(parsed)) {
          const note = str(parsed.systemMessage);
          if (note) lines.push(...toLines(note));
          continue;
        }
      } catch {
        // Not JSON after all: shown as text.
      }
    }
    lines.push(...toLines(part));
  }
  return lines;
}

function blocksOf(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function textOf(content: unknown): string {
  return blocksOf(content)
    .map((block) =>
      isObject(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("\n")
    .trim();
}

/** `168000` as `168k`. */
function tokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 100) / 10}k` : `${count}`;
}

const ERROR_TEXT: Record<string, string> = {
  authentication_failed: "Claude Code could not sign in.",
  oauth_org_not_allowed: "This organization is not allowed to use this sign-in.",
  account_on_hold: "The account is on hold.",
  verification_required: "The account needs to be verified.",
  billing_error: "There is a problem with billing.",
  rate_limit: "Usage limit reached.",
  overloaded: "The API is overloaded.",
  invalid_request: "The request was not valid.",
  model_not_found: "The model was not found.",
  server_error: "The API had a server error.",
  max_output_tokens: "The reply was cut off at the output limit.",
  cloud_credential_error: "The cloud credentials did not work.",
  unknown: "Claude Code reported an error.",
};

function push(host: UncommonHost, item: UncommonItem): void {
  host.items.push(item);
}

/** An error line, unless the same words are already on screen for this turn. */
function addProblem(
  host: UncommonHost,
  entry: SdkEntry,
  tone: ProblemItem["tone"],
  text: string,
  resetsAt?: number,
): ProblemItem | undefined {
  const { uncommon } = host;
  if (uncommon.problemTexts.has(text)) return undefined;
  uncommon.problemTexts.add(text);
  const item: ProblemItem = {
    kind: "problem",
    key: `entry-${entry.seq}`,
    seq: entry.seq,
    tone,
    text,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
  push(host, item);
  return item;
}

function readStatus(host: UncommonHost, entry: SdkEntry): void {
  const { message } = entry;
  const { uncommon } = host;
  if (message.status === "compacting") {
    const item: CompactionItem = {
      kind: "compaction",
      key: `entry-${entry.seq}`,
      seq: entry.seq,
      state: "running",
    };
    uncommon.compaction = item;
    push(host, item);
    return;
  }
  const running = uncommon.compaction;
  if (message.compact_result === "failed") {
    const error = str(message.compact_error);
    if (running && running.state === "running") {
      running.state = "failed";
      if (error) running.error = error;
    } else {
      push(host, {
        kind: "compaction",
        key: `entry-${entry.seq}`,
        seq: entry.seq,
        state: "failed",
        ...(error ? { error } : {}),
      });
    }
    uncommon.compaction = undefined;
  } else if (message.compact_result === "success" && running?.state === "running") {
    // The boundary that says how much it saved follows (or came first): it fills this in.
    running.state = "done";
  }
}

function readBoundary(host: UncommonHost, entry: SdkEntry): void {
  const meta = isObject(entry.message.compact_metadata)
    ? entry.message.compact_metadata
    : {};
  const before = typeof meta.pre_tokens === "number" ? meta.pre_tokens : undefined;
  const after = typeof meta.post_tokens === "number" ? meta.post_tokens : undefined;
  const trigger: CompactionItem["trigger"] =
    meta.trigger === "manual" || meta.trigger === "auto" ? meta.trigger : undefined;
  const filled = {
    state: "done" as const,
    seq: entry.seq,
    ...(trigger ? { trigger } : {}),
    ...(before === undefined ? {} : { tokensBefore: before }),
    ...(after === undefined ? {} : { tokensAfter: after }),
  };
  const open = host.uncommon.compaction;
  if (open && open.tokensBefore === undefined && open.state !== "failed") {
    Object.assign(open, filled);
  } else {
    push(host, { kind: "compaction", key: `entry-${entry.seq}`, ...filled });
  }
  host.uncommon.compaction = undefined;
}

/** Servers that failed or need signing in are shown when that changes; pending is just the start. */
function readMcpServers(host: UncommonHost, entry: SdkEntry): void {
  const servers = entry.message.mcp_servers;
  if (!Array.isArray(servers)) return;
  const { mcpProblems } = host.uncommon;
  const lines: McpItem["lines"] = [];
  const problems = new Map<string, string[]>();
  for (const server of servers) {
    if (!isObject(server)) continue;
    const name = str(server.name);
    const status = str(server.status);
    if (!name || !status) continue;
    if (status === "failed" || status === "needs-auth") {
      if (mcpProblems.get(name) !== status) {
        mcpProblems.set(name, status);
        problems.set(status, [...(problems.get(status) ?? []), name]);
      }
    } else if (status === "connected" && mcpProblems.has(name)) {
      mcpProblems.delete(name);
      lines.push({ text: `MCP server ${name} connected`, tone: "ok" });
    }
  }
  const failed = problems.get("failed");
  if (failed)
    lines.unshift({ text: `MCP servers failed: ${failed.join(", ")}`, tone: "problem" });
  const auth = problems.get("needs-auth");
  if (auth)
    lines.unshift({
      text: `MCP servers need sign-in: ${auth.join(", ")}`,
      tone: "problem",
    });
  if (lines.length > 0) {
    push(host, { kind: "mcp", key: `entry-${entry.seq}`, seq: entry.seq, lines });
  }
}

function readSystem(host: UncommonHost, entry: SdkEntry): boolean {
  const { message } = entry;
  const { uncommon } = host;
  switch (message.subtype) {
    case "init":
      readMcpServers(host, entry);
      return false; // items.ts reads the model and folder
    case "status":
      readStatus(host, entry);
      return true;
    case "compact_boundary":
      readBoundary(host, entry);
      return true;
    case "hook_started":
    case "hook_progress":
      return true; // what it printed comes with its response
    case "hook_response": {
      const outcome =
        message.outcome === "error" || message.outcome === "cancelled"
          ? message.outcome
          : "success";
      const lines = hookLines(message);
      // A hook that ran and said nothing is not a line: most of them do.
      if (lines.length > 0 || outcome !== "success") {
        push(host, {
          kind: "hook",
          key: `entry-${entry.seq}`,
          seq: entry.seq,
          name: str(message.hook_name) ?? str(message.hook_event) ?? "hook",
          outcome,
          lines,
        });
      }
      return true;
    }
    case "elicitation_complete": {
      const server = str(message.mcp_server_name) ?? "an MCP server";
      push(host, {
        kind: "mcp",
        key: `entry-${entry.seq}`,
        seq: entry.seq,
        lines: [{ text: `MCP server ${server} finished a request`, tone: "ok" }],
      });
      return true;
    }
    case "api_retry": {
      const attempt = typeof message.attempt === "number" ? message.attempt : undefined;
      const max =
        typeof message.max_retries === "number" ? message.max_retries : undefined;
      const delay =
        typeof message.retry_delay_ms === "number"
          ? Math.max(1, Math.round(message.retry_delay_ms / 1000))
          : undefined;
      const status =
        typeof message.error_status === "number" ? ` ${message.error_status}` : "";
      const why = str(message.error);
      const text =
        `API error${status}${why ? ` (${why.replace(/_/g, " ")})` : ""}: retrying` +
        `${delay === undefined ? "" : ` in ${delay}s`}` +
        `${attempt === undefined ? "" : ` (attempt ${attempt}${max === undefined ? "" : ` of ${max}`})`}`;
      // Successive retries are one line that counts, while it is the last line.
      if (uncommon.retry && host.items[host.items.length - 1] === uncommon.retry) {
        uncommon.retry.text = text;
        uncommon.retry.seq = entry.seq;
      } else {
        const item: ProblemItem = {
          kind: "problem",
          key: `entry-${entry.seq}`,
          seq: entry.seq,
          tone: "retry",
          text,
        };
        uncommon.retry = item;
        push(host, item);
      }
      return true;
    }
    case "informational":
    case "notification": {
      const text = (str(message.content) ?? str(message.text) ?? "").trim();
      // A plain `info` banner is for the terminal's transcript mode; a notification of low or
      // medium priority is a passing note in its status bar. Neither is part of the
      // conversation. What is left (a warning, a suggestion, a high-priority notification, a
      // folder trust warning) is the owner's to see.
      const loud =
        message.subtype === "informational"
          ? message.level !== "info"
          : message.priority === "high" || message.priority === "immediate";
      if (text !== "" && loud) {
        push(host, {
          kind: "notice",
          key: `entry-${entry.seq}`,
          seq: entry.seq,
          tone:
            message.level === "warning" || message.priority === "immediate"
              ? "warning"
              : "notice",
          text,
        });
      }
      return true;
    }
    default:
      return false;
  }
}

function readRateLimit(host: UncommonHost, entry: SdkEntry): void {
  const info = isObject(entry.message.rate_limit_info)
    ? entry.message.rate_limit_info
    : {};
  // `allowed` comes with every first turn: only a warning or a refusal is a line.
  if (info.status !== "allowed_warning" && info.status !== "rejected") return;
  const kind = str(info.rateLimitType)?.replace(/_/g, " ");
  const resetsAt = typeof info.resetsAt === "number" ? info.resetsAt : undefined;
  const percent =
    typeof info.utilization === "number"
      ? ` (${Math.round(info.utilization * 100)}% used)`
      : "";
  const text =
    info.status === "rejected"
      ? `Usage limit reached${kind ? ` (${kind})` : ""}.`
      : `Approaching the usage limit${kind ? ` (${kind})` : ""}${percent}.`;
  if (info.status === "rejected") {
    if (host.uncommon.limit) return; // the assistant's message said it already
    const item = addProblem(host, entry, "limit", text, resetsAt);
    if (item) host.uncommon.limit = item;
  } else {
    addProblem(host, entry, "limit", text, resetsAt);
  }
}

function readAssistantError(host: UncommonHost, entry: SdkEntry): void {
  const { message } = entry;
  const code = str(message.error) ?? "unknown";
  const inner = isObject(message.message) ? message.message : {};
  const text = textOf(inner.content) || ERROR_TEXT[code] || ERROR_TEXT.unknown || "";
  const { uncommon } = host;
  if (code === "rate_limit") {
    // Claude Code's own words ("You've hit your limit · resets 3pm") replace the generic line.
    if (uncommon.limit) {
      uncommon.limit.text = text;
      uncommon.limit.seq = entry.seq;
      uncommon.problemTexts.add(text);
      return;
    }
    const item = addProblem(host, entry, "limit", text);
    if (item) uncommon.limit = item;
    return;
  }
  addProblem(host, entry, "error", text);
}

function readResult(host: UncommonHost, entry: SdkEntry): void {
  const { message } = entry;
  const { uncommon } = host;
  const failed = message.is_error === true || str(message.subtype)?.startsWith("error");
  // An interrupt ends in an `error_during_execution` result with a diagnostic: it is not an error.
  if (failed && !uncommon.interrupted) {
    const errors = Array.isArray(message.errors)
      ? message.errors.filter((line): line is string => typeof line === "string")
      : [];
    const text =
      (str(message.result) ?? "").trim() ||
      errors.join("\n") ||
      `Claude Code stopped with an error (${str(message.subtype) ?? "unknown"}).`;
    addProblem(host, entry, "error", text);
  }
  uncommon.interrupted = false;
  uncommon.limit = undefined;
  uncommon.compaction = undefined;
  uncommon.problemTexts.clear();
}

/**
 * The reader for a top-level SDK message (not a subagent's). True when it is handled here and
 * `items.ts` has nothing more to do with it; false for what it reads only in part (`init`,
 * `result`, `user`, `assistant`: `items.ts` carries on) or not at all.
 */
export function readUncommonMessage(host: UncommonHost, entry: SdkEntry): boolean {
  const { message } = entry;
  const { uncommon } = host;
  switch (message.type) {
    case "system":
      return readSystem(host, entry);
    case "rate_limit_event":
      readRateLimit(host, entry);
      return true;
    case "assistant": {
      if (message.aborted === true) uncommon.interrupted = true;
      if (typeof message.error === "string") {
        readAssistantError(host, entry);
        return true;
      }
      return false;
    }
    case "user": {
      const inner = isObject(message.message) ? message.message : {};
      if (
        message.isReplay !== true &&
        textOf(inner.content).startsWith("[Request interrupted by user")
      ) {
        uncommon.interrupted = true;
      }
      return false;
    }
    case "conversation_reset":
      // A new conversation starts a new task list.
      uncommon.todos = undefined;
      return false;
    case "result":
      readResult(host, entry);
      return false; // items.ts ends the tool calls still running
    default:
      return false;
  }
}

const TODO_STATUS: Record<string, TodoStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
};

function readTodoWrite(
  host: UncommonHost,
  entry: SdkEntry,
  block: Record<string, unknown>,
  index: number,
): void {
  const input = isObject(block.input) ? block.input : {};
  const todos: TodosItem["todos"] = [];
  for (const todo of Array.isArray(input.todos) ? input.todos : []) {
    if (!isObject(todo)) continue;
    const content = str(todo.content);
    if (content === undefined) continue;
    todos.push({
      content,
      activeForm: str(todo.activeForm) ?? content,
      status: TODO_STATUS[str(todo.status) ?? ""] ?? "pending",
    });
  }
  const { uncommon } = host;
  const shown = uncommon.todos;
  if (todos.length === 0) {
    // An emptied list is gone, as in the terminal.
    if (shown) host.items.splice(host.items.indexOf(shown), 1);
    uncommon.todos = undefined;
    return;
  }
  if (shown?.todos.some((todo) => todo.status !== "completed")) {
    // The list Claude is working through changes where it stands.
    shown.todos = todos;
    shown.seq = entry.seq;
    return;
  }
  // The first list, or a new one after the last was finished.
  const item: TodosItem = {
    kind: "todos",
    key: `entry-${entry.seq}-${index}`,
    seq: entry.seq,
    todos,
  };
  uncommon.todos = item;
  push(host, item);
}

function readAdvisorResult(
  host: UncommonHost,
  entry: SdkEntry,
  block: Record<string, unknown>,
  index: number,
): void {
  const id = str(block.tool_use_id);
  // The recordings show the result as `advisor_tool_result` with its content inside; a bare
  // `advisor_redacted_result` block is read the same way.
  const content = block.type === "advisor_tool_result" ? block.content : block;
  const result = isObject(content) ? content : {};
  const { advisors } = host.uncommon;
  let item = id === undefined ? undefined : advisors.get(id);
  if (!item) {
    // The latest consultation that has no answer yet, or a new one if the use was not seen
    // (it is in an earlier page of the log).
    item = [...advisors.values()].reverse().find((one) => one.status === "consulting");
  }
  if (!item) {
    item = {
      kind: "advisor",
      key: `entry-${entry.seq}-${index}`,
      toolUseId: id ?? "",
      status: "consulting",
    };
    if (id !== undefined) advisors.set(id, item);
    push(host, item);
  }
  item.seq = entry.seq;
  if (result.type === "advisor_result") {
    const text = str(result.text)?.trim();
    item.status = text ? "advice" : "encrypted";
    if (text) item.text = text;
  } else if (result.type === "advisor_tool_result_error") {
    item.status = "error";
    const code = str(result.error_code);
    if (code) item.errorCode = code;
  } else {
    // `advisor_redacted_result`, or a shape not known yet: the advisor answered.
    item.status = "encrypted";
  }
}

/**
 * The reader for one content block of a top-level assistant message. True when it is handled
 * here: the advisor's two blocks and `TodoWrite`. Any other block is `items.ts`'s.
 */
export function readUncommonBlock(
  host: UncommonHost,
  entry: SdkEntry,
  block: Record<string, unknown>,
  index: number,
): boolean {
  switch (block.type) {
    case "server_tool_use": {
      // Only the advisor's: the other server tools (web search...) are not read here.
      const id = str(block.id);
      if (block.name !== "advisor" || id === undefined) return false;
      const item: AdvisorItem = {
        kind: "advisor",
        key: `entry-${entry.seq}-${index}`,
        seq: entry.seq,
        toolUseId: id,
        status: "consulting",
      };
      host.uncommon.advisors.set(id, item);
      push(host, item);
      return true;
    }
    case "advisor_tool_result":
    case "advisor_redacted_result":
      readAdvisorResult(host, entry, block, index);
      return true;
    case "tool_use":
      if (block.name !== "TodoWrite") return false;
      readTodoWrite(host, entry, block, index);
      return true;
    default:
      return false;
  }
}

/** The tokens of a compaction, for its line: `168k to 12k tokens`. */
export function compactionSummary(item: CompactionItem): string {
  const parts: string[] = [];
  if (item.trigger) parts.push(item.trigger);
  if (item.tokensBefore !== undefined) {
    parts.push(
      item.tokensAfter === undefined
        ? `${tokens(item.tokensBefore)} tokens`
        : `${tokens(item.tokensBefore)} to ${tokens(item.tokensAfter)} tokens`,
    );
  }
  return parts.join(", ");
}
