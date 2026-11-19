import type { LogEntry, PermissionReply } from "../../../src/shared/agent-protocol.ts";
import { queuedPromptIds } from "./prompts";
import { isTaskMessage, TaskBuilder, type TaskItem, type TaskView } from "./tasks";
import {
  contentLines,
  type DiffLine,
  type ToolResultView,
  toolDiff,
  toolResultView,
  toolTarget,
} from "./toolDisplay";
import {
  terminalOnlyCommand,
  type Unsupported,
  unsupportedInMessage,
  unsupportedOfDeclined,
} from "./unsupported";

/**
 * What the Transcript shows, in Claude TUI's shape: the items `buildItems` makes from the log's
 * entries, one component each (`components/agent/TranscriptItemView.tsx`). Pure: no React, no
 * DOM.
 *
 * **To show a new kind of thing** (the later tickets of the Claude Agent spec each add one):
 * 1. add its interface here, with a `kind`, and to the `TranscriptItem` union;
 * 2. make it in `buildItems` below, from the entry it comes from (`readSdkMessage` for an SDK
 *    message, the switch in `buildItems` for the other kinds of entry), and carry the entry's
 *    `seq` so that the Raw view (#137) can show the message it came from (text still streaming
 *    in has no entry yet, so no `seq`); a row built from several entries sets the one the owner
 *    would call "the message";
 * 3. give it a component, and a case in `TranscriptItemView` (TypeScript says where: the
 *    `never` check there fails until the case exists).
 */

interface ItemBase {
  /** Stable across renders, so that a streaming item keeps its place. */
  key: string;
  /** The `seq` of the log entry the item comes from; absent for text still streaming in. */
  seq?: number;
}

/** A prompt the owner sent, from any device (`>` in a band). */
export interface PromptItem extends ItemBase {
  kind: "prompt";
  text: string;
  /**
   * Claude Code has not picked it up yet: it was sent during a turn (or an instant ago) and
   * waits its turn (`prompts.ts`, #138).
   */
  queued: boolean;
  /** The names of the images it carried (`PromptImages`); absent when it carried none. */
  images?: string[];
}

/** Claude's prose (`⏺`), markdown. Complete, or still streaming in. */
export interface AssistantItem extends ItemBase {
  kind: "assistant";
  text: string;
  streaming: boolean;
}

/** One muted line: `✻ Thought for 3s`, or `✻ Thinking…` while it runs. */
export interface ThinkingItem extends ItemBase {
  kind: "thinking";
  /** How long Claude thought, when Claude Code said. */
  seconds?: number;
  streaming: boolean;
}

/** How a tool call stands. Running is a spinner, done is green, the rest are red. */
export type ToolStatus = "running" | "done" | "denied" | "interrupted" | "failed";

/** A tool call (`⏺ Bash(ls)`) with its result under `⎿`. */
export interface ToolItem extends ItemBase {
  kind: "tool";
  /** The `tool_use` block's id: what its result and its permission ask name. */
  toolUseId: string;
  /** The tool's name as Claude Code has it (`Bash`, `Edit`, `mcp__x__y`). */
  name: string;
  /** What it acts on: `ls -la` in `Bash(ls -la)`. */
  target: string;
  status: ToolStatus;
  /** Absent while it runs. */
  result?: ToolResultView;
  /** For an edit: the lines changed, from its input at first and Claude Code's patch once it ran. */
  diff?: DiffLine[];
  /** For a subagent or a command run in the background: its task, shown on this line (#149). */
  task?: TaskView;
}

/** `⎿ Interrupted`: the owner stopped Claude (the `[Request interrupted by user]` message). */
export interface InterruptedItem extends ItemBase {
  kind: "interrupted";
}

/**
 * `⎿ permission: allowed`: how an ask the owner answered ended, left in the Transcript where
 * the answer came. Not made for an ask nobody answered (withdrawn, or the Agent stopped): the
 * tool's own red mark says that.
 */
export interface PermissionItem extends ItemBase {
  kind: "permission";
  /** What was answered: `allowed`, `allowed, and won't ask again`, `denied: <reply>`. */
  answer: string;
}

/**
 * Something Claude met that k-bench can't show or answer (#153): `⚠ Unsupported`, what Claude
 * tried in plain words, and a button for the raw view. It raises no Bell. `unsupportedKind`
 * (`unsupported.ts`) is its kind for the running list (#154).
 */
export interface UnsupportedItem extends ItemBase, Unsupported {
  kind: "unsupported";
}

export type TranscriptItem =
  | PromptItem
  | AssistantItem
  | ThinkingItem
  | ToolItem
  | InterruptedItem
  | TaskItem
  | PermissionItem
  | UnsupportedItem;

/** What the entries say beyond the items: the header's model and folder. */
export interface BuiltTranscript {
  items: TranscriptItem[];
  /** The model of the latest turn (`system/init.model`); absent before the first turn. */
  model?: string;
  /** Claude Code's working folder (`system/init.cwd`); absent before the first turn. */
  cwd?: string;
  /**
   * Whether Claude Code runs in Focus view (`system/init.view_mode` is `focus`), where a tool
   * call is one collapsed line. Its own report, so it holds however the Agent was launched.
   */
  focusView: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The blocks of a message's content (a bare string is one text block). */
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
    .join("\n");
}

/** A tool call as the builder holds it until its result arrives. */
interface OpenTool {
  item: ToolItem;
  input: Record<string, unknown>;
}

/** What `buildItems` carries from entry to entry. */
interface BuildState {
  items: TranscriptItem[];
  model?: string;
  cwd?: string;
  focusView: boolean;
  /** The tool calls by `tool_use` id, to pair results with. */
  tools: Map<string, OpenTool>;
  /** The ids of the prompts k-bench sent: their echoes are the same prompt. */
  promptIds: Set<string>;
  /** The prompts Claude Code has not picked up yet. */
  queued: ReadonlySet<string>;
  /** Which tool call each ask is about, by request id. */
  askTool: Map<string, string>;
  /** The tool calls the owner denied. */
  denied: Set<string>;
  /** The subagents and background tasks (`tasks.ts`, #149). */
  tasks: TaskBuilder;
}

/**
 * Tool calls still without a result when their turn ends, or the runtime does, never got one:
 * they are red, with no result line of their own (the `Interrupted` line that follows an
 * interrupt says it once).
 */
function interruptRunningTools(state: BuildState): void {
  for (const { item } of state.tools.values()) {
    if (item.status === "running") {
      item.status = "interrupted";
    }
  }
}

/** Whether Claude Code's result message says the tool did not run for lack of permission. */
function rejectedByMeta(message: Record<string, unknown>, toolUseId: string): boolean {
  const meta = message.tool_result_meta;
  if (!Array.isArray(meta)) return false;
  return meta.some(
    (entry) =>
      isObject(entry) &&
      entry.id === toolUseId &&
      isObject(entry.permission_decision) &&
      entry.permission_decision.decision === "reject",
  );
}

function resolveTool(
  state: BuildState,
  message: Record<string, unknown>,
  block: Record<string, unknown>,
): void {
  const id = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
  const open = id === undefined ? undefined : state.tools.get(id);
  if (!id || !open) return;
  const { item, input } = open;
  const toolUseResult = message.tool_use_result;
  const failed = block.is_error === true;
  const lines = contentLines(block.content);
  if (!failed) {
    // The patch Claude Code made replaces the one worked out from the input: it has the lines
    // around the change.
    const diff = toolDiff(item.name, input, toolUseResult);
    item.status = "done";
    item.diff = diff;
    item.result = toolResultView(
      item.name,
      input,
      block.content,
      toolUseResult,
      diff,
      state.cwd === undefined ? {} : { cwd: state.cwd },
    );
  } else if (state.denied.has(id) || rejectedByMeta(message, id)) {
    item.status = "denied";
    item.result = { summary: "Denied", lines: [] };
  } else if ((lines[0] ?? "").startsWith("[Request interrupted by user")) {
    item.status = "interrupted";
  } else {
    item.status = "failed";
    item.result = { lines };
  }
}

/** Unsupported rows (#153) for what the message or entry `seq` holds, where it happened. */
function addUnsupported(
  state: BuildState,
  seq: number,
  keyPart: string,
  found: readonly Unsupported[],
): void {
  found.forEach((one, index) => {
    const last = state.items.at(-1);
    // A terminal-only command that Claude Code also answered "isn't available" is one row.
    if (
      one.what === "command" &&
      last?.kind === "unsupported" &&
      last.what === "terminal-command" &&
      last.name === one.name
    ) {
      return;
    }
    state.items.push({
      kind: "unsupported",
      key: `entry-${keyPart}-${index}`,
      seq,
      ...one,
    });
  });
}

/** An SDK message that is part of the conversation: its items, if it makes any. */
function readSdkMessage(
  state: BuildState,
  entry: Extract<LogEntry, { kind: "sdk" }>,
): void {
  const { message } = entry;
  // What k-bench does not know shows wherever it came from, a subagent's included.
  addUnsupported(
    state,
    entry.seq,
    `${entry.seq}-unsupported`,
    unsupportedInMessage(message),
  );
  // A subagent's own messages are not the conversation's: its task line (#149) shows how it goes.
  if (message.parent_tool_use_id != null) return;
  switch (message.type) {
    case "system":
      if (isTaskMessage(message)) {
        state.tasks.read(entry, {
          attach(toolUseId, task) {
            const open = state.tools.get(toolUseId);
            if (open) open.item.task = task;
            return open !== undefined;
          },
          add: (item) => state.items.push(item),
        });
      } else if (message.subtype === "init") {
        if (typeof message.model === "string") state.model = message.model;
        if (typeof message.cwd === "string") state.cwd = message.cwd;
        // Claude Code says which commands only work in a terminal: one just typed is Unsupported.
        // The row's raw is this `init`, which says it.
        const last = state.items.at(-1);
        const terminalOnly =
          last?.kind === "prompt"
            ? terminalOnlyCommand(last.text, message.terminal_slash_commands)
            : undefined;
        if (terminalOnly) {
          addUnsupported(state, entry.seq, `${entry.seq}-terminal`, [terminalOnly]);
        }
        state.focusView = message.view_mode === "focus";
      }
      return;
    case "assistant": {
      const inner = isObject(message.message) ? message.message : {};
      const seconds =
        typeof message.thinking_duration_ms === "number"
          ? Math.round(message.thinking_duration_ms / 1000)
          : undefined;
      blocksOf(inner.content).forEach((block, index) => {
        if (!isObject(block)) return;
        const key = `entry-${entry.seq}-${index}`;
        if (block.type === "text" && typeof block.text === "string") {
          if (block.text.trim() === "") return;
          state.items.push({
            kind: "assistant",
            key,
            seq: entry.seq,
            text: block.text,
            streaming: false,
          });
        } else if (block.type === "thinking" || block.type === "redacted_thinking") {
          state.items.push({
            kind: "thinking",
            key,
            seq: entry.seq,
            ...(seconds === undefined ? {} : { seconds }),
            streaming: false,
          });
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const name = typeof block.name === "string" ? block.name : "";
          const input = isObject(block.input) ? block.input : {};
          const diff = toolDiff(name, input);
          const item: ToolItem = {
            kind: "tool",
            key,
            seq: entry.seq,
            toolUseId: block.id,
            name,
            target: toolTarget(
              name,
              input,
              state.cwd === undefined ? {} : { cwd: state.cwd },
            ),
            status: "running",
            ...(diff === undefined ? {} : { diff }),
          };
          state.items.push(item);
          state.tools.set(block.id, { item, input });
        }
      });
      return;
    }
    case "user": {
      const inner = isObject(message.message) ? message.message : {};
      const blocks = blocksOf(inner.content);
      const results = blocks.filter(
        (block): block is Record<string, unknown> =>
          isObject(block) && block.type === "tool_result",
      );
      if (results.length > 0) {
        for (const block of results) resolveTool(state, message, block);
      } else if (message.isSynthetic === true) {
        // Claude Code's own bookkeeping, not something anyone said.
      } else if (message.isReplay === true) {
        // The echo of a prompt. k-bench's own was already shown from its `prompt` entry; one
        // that k-bench did not send (typed in the terminal, imported) is shown here.
        const text = textOf(inner.content);
        const uuid = typeof message.uuid === "string" ? message.uuid : undefined;
        if (text.trim() !== "" && !(uuid && state.promptIds.has(uuid))) {
          state.items.push({
            kind: "prompt",
            key: `entry-${entry.seq}`,
            seq: entry.seq,
            text,
            queued: false,
          });
        }
      } else if (textOf(inner.content).startsWith("[Request interrupted by user")) {
        state.items.push({
          kind: "interrupted",
          key: `entry-${entry.seq}`,
          seq: entry.seq,
        });
      }
      return;
    }
    case "result":
      interruptRunningTools(state);
      state.tasks.turnEnded();
      return;
    default:
      // Everything else that Claude Code sends and k-bench knows (status, rate limits, hooks,
      // ...) shows nothing yet: the later tickets (#148, #152) each give their kinds a line.
      // What it does not know is an Unsupported row (above).
      return;
  }
}

/** How the permission line reads an owner's answer. */
function permissionAnswerText(answer: PermissionReply): string {
  if (answer.decision === "allow") {
    return answer.alwaysAllow ? "allowed, and won't ask again" : "allowed";
  }
  return answer.message === undefined ? "denied" : `denied: ${answer.message}`;
}

/**
 * The items of the entries, in order. Pure and complete: it reads every entry each time, so
 * a fix here changes how the whole history reads on the next load, as ADR-0008 wants.
 */
export function buildItems(entries: readonly LogEntry[]): BuiltTranscript {
  const state: BuildState = {
    items: [],
    focusView: false,
    tools: new Map(),
    promptIds: new Set(),
    queued: queuedPromptIds(entries),
    askTool: new Map(),
    denied: new Set(),
    tasks: new TaskBuilder(),
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case "prompt":
        state.promptIds.add(entry.id);
        state.items.push({
          kind: "prompt",
          key: `entry-${entry.seq}`,
          seq: entry.seq,
          text: entry.text,
          ...(entry.images && { images: entry.images }),
          queued: state.queued.has(entry.id),
        });
        break;
      case "sdk":
        readSdkMessage(state, entry);
        break;
      case "permission_asked":
        state.askTool.set(entry.requestId, entry.toolUseId);
        break;
      case "permission_answered": {
        const toolUseId = state.askTool.get(entry.requestId);
        const { answer } = entry;
        if (toolUseId && answer.decision === "deny") state.denied.add(toolUseId);
        if (answer.decision === "allow" || answer.decision === "deny") {
          state.items.push({
            kind: "permission",
            key: `entry-${entry.seq}`,
            seq: entry.seq,
            answer: permissionAnswerText(answer),
          });
        }
        break;
      }
      case "declined":
        // What the runtime declined for the owner (an MCP elicitation): it happened here.
        addUnsupported(state, entry.seq, `${entry.seq}-declined`, [
          unsupportedOfDeclined(entry.request),
        ]);
        break;
      case "runtime":
        // A runtime that starts or ends leaves no tool running: Claude Code died with it.
        interruptRunningTools(state);
        state.tasks.runtimeChanged();
        break;
    }
  }
  return {
    items: state.items,
    ...(state.model === undefined ? {} : { model: state.model }),
    ...(state.cwd === undefined ? {} : { cwd: state.cwd }),
    focusView: state.focusView,
  };
}
