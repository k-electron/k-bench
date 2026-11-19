import { createContext, memo, useContext } from "react";
import {
  type TaskItem,
  type TaskView,
  taskFacts,
  toolMarkWithTask,
} from "../../agent/tasks";
import { StatusMark } from "./StatusMark";

/**
 * What a Stop on a subagent or background task does (#149). `AgentPane` provides it around the
 * Transcript, so that the lines need no connection of their own.
 */
export interface StopTask {
  /** Asks Claude Code to stop that one task. False when it could not be sent (reconnecting). */
  stop(taskId: string): boolean;
  /** Nothing can be sent: the connection is down, or the Session is over. */
  disabled: boolean;
}

const StopTaskContext = createContext<StopTask>({ stop: () => false, disabled: true });

export const StopTaskProvider = StopTaskContext.Provider;

const VARIANT_NAME: Record<TaskView["variant"], string> = {
  subagent: "Subagent",
  background: "Background task",
};

/**
 * Under a task's line: `⎿ 3 tool uses · 1.2k tokens · 12s · Grep`, Claude Code's one-line
 * summary when it sent one, how it ended if it did not go well, and, while it runs, its own
 * Stop. Used on a tool call's line (`ToolCall`) and on a task's own (`TaskLine`).
 */
export const TaskDetail = memo(function TaskDetail({ task }: { task: TaskView }) {
  const { stop, disabled } = useContext(StopTaskContext);
  const facts = taskFacts(task);
  const ended =
    task.status === "stopped"
      ? "Stopped"
      : task.status === "interrupted"
        ? "Interrupted"
        : task.status === "failed"
          ? "Failed"
          : undefined;
  const text = [ended, ...facts].filter(Boolean).join(" · ");
  return (
    <div className="flex items-baseline gap-2 pl-5 text-muted-foreground">
      <span aria-hidden className="select-none">
        ⎿
      </span>
      <div className="min-w-0 flex-1">
        {text !== "" && <div>{text}</div>}
        {task.summary && task.status === "running" && <div>{task.summary}</div>}
        {task.status === "running" && (
          <button
            type="button"
            aria-label={`Stop ${task.description}`}
            disabled={disabled}
            onClick={() => stop(task.taskId)}
            className="mt-0.5 rounded border border-white/20 px-2 py-0.5 text-xs text-foreground hover:bg-white/10 disabled:opacity-50"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
});

/** A task whose tool call is not in the Transcript: `⏺ Subagent(description)` and its detail. */
export const TaskLine = memo(function TaskLine({ item }: { item: TaskItem }) {
  const { task } = item;
  const name = VARIANT_NAME[task.variant];
  return (
    <article aria-label={`${name}(${task.description})`} className="my-1.5">
      <div className="flex gap-2">
        <StatusMark status={toolMarkWithTask("done", task)} />
        <span className="min-w-0 break-words">
          <strong>{name}</strong>
          <span className="text-muted-foreground">({task.description})</span>
        </span>
      </div>
      <TaskDetail task={task} />
    </article>
  );
});
