import type { LogEntry } from "../../../src/shared/agent-protocol.ts";
import type { ToolStatus } from "./items";

/**
 * Subagents and background tasks in the Transcript (#149), read from the `system/task_*` and
 * `background_tasks_changed` messages in the log. Pure, like `buildItems`, which owns a
 * `TaskBuilder` and feeds it every SDK message.
 *
 * A subagent is an `Agent` tool call plus a task with the same `tool_use_id`, and a background
 * command is a `Bash` tool call (it runs in the background) plus one: such a task is shown
 * **on the tool's own line** (`ToolItem.task`), so one thing is not two lines. A task whose tool
 * call is not among the items (its turn was paged out, or Claude Code started it by itself) is a
 * line of its own (`TaskItem`).
 */

/** How a task stands. Running is a spinner, done is green, the rest are red. */
export type TaskStatus = "running" | "done" | "failed" | "stopped" | "interrupted";

/** One subagent or background task, as the Transcript shows it. */
export interface TaskView {
  /** Claude Code's `task_id`: what `stop_task` names. */
  taskId: string;
  /** An agent Claude launched, or a background command and the like. */
  variant: "subagent" | "background";
  description: string;
  status: TaskStatus;
  /** The latest `task_progress`, or the final usage in the `task_notification`. */
  toolUses?: number;
  tokens?: number;
  durationMs?: number;
  /** The tool the task used last, and Claude Code's own one-line summary when it sends one. */
  lastTool?: string;
  summary?: string;
}

/** A task with no tool call among the items: a line of its own (`⏺ Subagent(description)`). */
export interface TaskItem {
  kind: "task";
  key: string;
  /** The `seq` of its `task_started` entry (what the Raw view shows). */
  seq?: number;
  task: TaskView;
}

/** What `TaskBuilder` needs of the items being built. */
export interface TaskHooks {
  /** Puts the task on the line of the tool call with this `tool_use_id`; false when there is none. */
  attach(toolUseId: string, task: TaskView): boolean;
  /** Adds a line of its own. */
  add(item: TaskItem): void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const FINAL: Record<string, TaskStatus> = {
  completed: "done",
  failed: "failed",
  stopped: "stopped",
  killed: "stopped",
};

/** Whether the message is one `TaskBuilder` reads. */
export function isTaskMessage(message: Record<string, unknown>): boolean {
  return (
    message.type === "system" &&
    typeof message.subtype === "string" &&
    (message.subtype.startsWith("task_") ||
      message.subtype === "background_tasks_changed")
  );
}

/** Keeps the tasks of one pass over the log, and their state as the later messages change it. */
export class TaskBuilder {
  private readonly views = new Map<string, TaskView>();
  /** The tasks that outlive their turn; the others end when it does. */
  private readonly background = new Set<string>();

  /** Reads one task message of the entry. */
  read(entry: Extract<LogEntry, { kind: "sdk" }>, hooks: TaskHooks): void {
    const { message } = entry;
    if (message.subtype === "background_tasks_changed") {
      if (!Array.isArray(message.tasks)) return;
      for (const task of message.tasks) {
        if (isObject(task) && typeof task.task_id === "string") {
          this.background.add(task.task_id);
        }
      }
      return;
    }
    const id = message.task_id;
    if (typeof id !== "string") return;
    if (message.subtype === "task_started") {
      // Housekeeping tasks are not activity: they are never shown.
      if (message.ambient === true || message.skip_transcript === true) return;
      const view: TaskView = {
        taskId: id,
        variant:
          message.task_type === "local_agent" ||
          (message.task_type === undefined && typeof message.subagent_type === "string")
            ? "subagent"
            : "background",
        description: typeof message.description === "string" ? message.description : id,
        status: "running",
      };
      this.views.set(id, view);
      if (message.is_backgrounded === true) this.background.add(id);
      const toolUseId =
        typeof message.tool_use_id === "string" ? message.tool_use_id : undefined;
      if (!(toolUseId && hooks.attach(toolUseId, view))) {
        hooks.add({
          kind: "task",
          key: `entry-${entry.seq}`,
          seq: entry.seq,
          task: view,
        });
      }
      return;
    }
    const view = this.views.get(id);
    if (!view) return;
    if (message.subtype === "task_progress") {
      this.usage(view, message.usage);
      if (typeof message.last_tool_name === "string")
        view.lastTool = message.last_tool_name;
      if (typeof message.summary === "string") view.summary = message.summary;
    } else if (message.subtype === "task_updated") {
      const patch = isObject(message.patch) ? message.patch : {};
      const final = typeof patch.status === "string" ? FINAL[patch.status] : undefined;
      if (final) view.status = final;
      if (typeof patch.description === "string") view.description = patch.description;
      if (patch.is_backgrounded === true) this.background.add(id);
    } else if (message.subtype === "task_notification") {
      const final =
        typeof message.status === "string" ? FINAL[message.status] : undefined;
      if (final) view.status = final;
      this.usage(view, message.usage);
      if (typeof message.summary === "string" && message.summary !== "") {
        view.summary = message.summary;
      }
    }
  }

  /** A turn's `result`: a task that blocked its turn cannot still be running. */
  turnEnded(): void {
    for (const [id, view] of this.views) {
      if (view.status === "running" && !this.background.has(id)) {
        view.status = "interrupted";
      }
    }
  }

  /** A runtime started or ended: Claude Code died with it, and every task with it. */
  runtimeChanged(): void {
    for (const view of this.views.values()) {
      if (view.status === "running") view.status = "interrupted";
    }
  }

  private usage(view: TaskView, usage: unknown): void {
    if (!isObject(usage)) return;
    if (typeof usage.tool_uses === "number") view.toolUses = usage.tool_uses;
    if (typeof usage.total_tokens === "number") view.tokens = usage.total_tokens;
    if (typeof usage.duration_ms === "number") view.durationMs = usage.duration_ms;
  }
}

/**
 * What the `⏺` of a tool call shows when a task rides on it. A task that is still running keeps
 * the spinner even if the tool call itself already returned (a command started in the
 * background returns at once); a task that went wrong turns it red; otherwise it is the tool's.
 */
export function toolMarkWithTask(
  status: ToolStatus,
  task: TaskView | undefined,
): ToolStatus {
  if (!task) return status;
  if (task.status === "running") return "running";
  if (status === "denied") return status;
  if (task.status === "failed") return "failed";
  if (task.status === "stopped" || task.status === "interrupted") return "interrupted";
  return status;
}

/** `1.2k` for 1234, `850` for 850: tokens are only ever glanced at. */
function compact(count: number): string {
  return count < 1000
    ? String(count)
    : `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/** The facts under a task: `3 tool uses · 1.2k tokens · 12s · Grep`, as many as are known. */
export function taskFacts(task: TaskView): string[] {
  const facts: string[] = [];
  if (task.toolUses !== undefined) {
    facts.push(`${task.toolUses} tool ${task.toolUses === 1 ? "use" : "uses"}`);
  }
  if (task.tokens !== undefined) facts.push(`${compact(task.tokens)} tokens`);
  if (task.durationMs !== undefined && task.durationMs > 0) {
    facts.push(`${Math.round(task.durationMs / 1000)}s`);
  }
  if (task.status === "running" && task.lastTool) facts.push(task.lastTool);
  return facts;
}
