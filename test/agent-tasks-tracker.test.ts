import { describe, expect, it } from "vitest";
import { TaskTracker } from "../src/agent-runtime/tasks.ts";

// A subagent as the live check recorded it from a real Claude Code (#161; ids made up): the Agent
// tool launches it asynchronously, so it is backgrounded and listed in `background_tasks_changed`
// (which comes before its `task_started`), and it runs until a `task_notification` says it ended.

const launched = [
  {
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [
      {
        task_id: "a1",
        task_type: "local_agent",
        subagent_type: "kb-probe",
        description: "Probe agent reply",
      },
    ],
  },
  {
    type: "system",
    subtype: "task_started",
    task_id: "a1",
    tool_use_id: "toolu_1",
    description: "Probe agent reply",
    subagent_type: "kb-probe",
    is_backgrounded: true,
    task_type: "local_agent",
  },
];

describe("the subagents and background tasks Claude Code is running", () => {
  it("lists a backgrounded subagent from its launch, through the end of the turn, until Claude Code says it ended", () => {
    const tracker = new TaskTracker();
    for (const message of launched) tracker.observe(message as never);
    expect(tracker.list).toEqual([
      { id: "a1", kind: "subagent", description: "Probe agent reply" },
    ]);

    // The turn that launched it ends: a task that is backgrounded outlives it.
    tracker.observe({ type: "result", subtype: "success" } as never);
    expect(tracker.list.map((task) => task.id)).toEqual(["a1"]);

    // Then Claude Code says it ended, and the list is empty again.
    tracker.observe({
      type: "system",
      subtype: "task_updated",
      task_id: "a1",
      patch: { status: "completed" },
    } as never);
    tracker.observe({
      type: "system",
      subtype: "task_notification",
      task_id: "a1",
      status: "completed",
    } as never);
    tracker.observe({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [],
    } as never);
    expect(tracker.list).toEqual([]);
  });

  it("drops a task that was not backgrounded with the turn that was waiting for it", () => {
    const tracker = new TaskTracker();
    tracker.observe({
      type: "system",
      subtype: "task_started",
      task_id: "f1",
      description: "foreground",
      task_type: "local_agent",
      is_backgrounded: false,
    } as never);
    expect(tracker.list.map((task) => task.id)).toEqual(["f1"]);
    tracker.observe({ type: "result", subtype: "success" } as never);
    expect(tracker.list).toEqual([]);
  });
});
