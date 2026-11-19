import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTask } from "../shared/agent-protocol.ts";

/** What `TaskTracker` reads of a task, in the shapes `system/task_*` and the level carry. */
interface TaskFields {
  task_id?: unknown;
  task_type?: unknown;
  subagent_type?: unknown;
  description?: unknown;
  is_backgrounded?: unknown;
  ambient?: unknown;
  skip_transcript?: unknown;
}

interface Tracked {
  task: AgentTask;
  /** It outlives its turn. A foreground task blocks its tool call, so it cannot. */
  background: boolean;
}

/** Task types that are subagents: Claude Code's `local_agent`. */
function kindOf(fields: TaskFields): AgentTask["kind"] {
  return fields.task_type === "local_agent" ||
    (fields.task_type === undefined && typeof fields.subagent_type === "string")
    ? "subagent"
    : "background";
}

/**
 * The subagents and background tasks running now, as Claude Code's messages say (ticket
 * #149): `task_started` and `task_notification` bracket each one, `task_updated` can end one
 * too, and `background_tasks_changed` is the full list of the background ones, which replaces
 * what was held (so a missed bookend cannot leave a task running here for ever). Tasks that
 * are not activity (`ambient`, `skip_transcript`) are left out, as the SDK tells hosts to.
 *
 * Nothing here knows about the log or the socket; `main.ts` publishes `list` in the status.
 */
export class TaskTracker {
  private readonly tasks = new Map<string, Tracked>();

  /** The running tasks, in the order they started. */
  get list(): AgentTask[] {
    return [...this.tasks.values()].map(({ task }) => ({ ...task }));
  }

  /** Reads a message from Claude Code; true when it changed what is running. */
  observe(message: SDKMessage): boolean {
    const before = JSON.stringify(this.list);
    this.read(message as unknown as Record<string, unknown>);
    return JSON.stringify(this.list) !== before;
  }

  private read(message: Record<string, unknown>): void {
    const fields = message as TaskFields;
    if (message.type === "result") {
      // A foreground task blocks its turn, so none can be running once it has ended.
      for (const [id, { background }] of [...this.tasks]) {
        if (!background) this.tasks.delete(id);
      }
      return;
    }
    if (message.type === "conversation_reset") {
      this.tasks.clear();
      return;
    }
    if (message.type !== "system") return;
    if (message.subtype === "background_tasks_changed") {
      this.replaceBackground(message.tasks);
      return;
    }
    if (typeof fields.task_id !== "string") return;
    const id = fields.task_id;
    switch (message.subtype) {
      case "task_started":
        if (fields.ambient === true || fields.skip_transcript === true) return;
        this.upsert(id, fields, fields.is_backgrounded === true);
        return;
      case "task_updated": {
        const patch = (message.patch ?? {}) as TaskFields & { status?: unknown };
        const tracked = this.tasks.get(id);
        if (!tracked) return;
        if (
          patch.status === "completed" ||
          patch.status === "failed" ||
          patch.status === "killed"
        ) {
          this.tasks.delete(id);
          return;
        }
        if (typeof patch.description === "string") {
          tracked.task.description = patch.description;
        }
        if (patch.is_backgrounded === true) tracked.background = true;
        return;
      }
      case "task_notification":
        this.tasks.delete(id);
        return;
    }
  }

  /** `background_tasks_changed`: the background tasks are exactly these. */
  private replaceBackground(tasks: unknown): void {
    if (!Array.isArray(tasks)) return;
    const live = new Set<string>();
    for (const entry of tasks) {
      const fields = (
        typeof entry === "object" && entry !== null ? entry : {}
      ) as TaskFields;
      if (typeof fields.task_id !== "string" || fields.ambient === true) continue;
      live.add(fields.task_id);
      this.upsert(fields.task_id, fields, true);
    }
    for (const [id, { background }] of [...this.tasks]) {
      if (background && !live.has(id)) this.tasks.delete(id);
    }
  }

  private upsert(id: string, fields: TaskFields, background: boolean): void {
    const known = this.tasks.get(id);
    const description =
      typeof fields.description === "string"
        ? fields.description
        : (known?.task.description ?? id);
    this.tasks.set(id, {
      task: { id, kind: kindOf(fields), description },
      background: background || known?.background === true,
    });
  }
}
