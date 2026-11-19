import { describe, expect, it } from "vitest";
import type { SessionState, Snapshot } from "../src/shared/state-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.

/** The task IDs the SDK asked the fake to stop, in order. */
const stopped = (fakeClaude: FakeClaude) =>
  fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "control_request" && entry.message.request.subtype === "stop_task"
        ? [entry.message.request.task_id]
        : [],
    );

describe("a Claude Agent's subagents and background tasks", () => {
  it("are listed in its status for every client and in the state snapshot, a Stop ends only the one it names, and a task that finishes leaves the list", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const events = await server.openEvents();
    const client = await server.openAgent(session.id);
    const other = await server.openAgent(session.id);
    await client.sync();
    const agentOf = (snapshot: Snapshot): SessionState["agent"] =>
      snapshot.workspaces.flatMap((w) => w.sessions).find((s) => s.id === session.id)
        ?.agent;
    expect(client.status?.tasks).toBeUndefined();

    fakeClaude.script([
      {
        tool: {
          name: "Agent",
          input: { description: "Survey the tests", subagent_type: "Explore" },
          id: "toolu_survey",
        },
        task: {
          id: "survey",
          description: "Survey the tests",
          subagentType: "Explore",
          background: true,
        },
        result: "Async agent launched",
      },
      {
        tool: {
          name: "Bash",
          input: { command: "pnpm dev", run_in_background: true },
          id: "toolu_dev",
        },
        task: {
          id: "dev",
          description: "pnpm dev",
          type: "bash",
          background: true,
        },
        result: "Command running in background with ID: dev",
      },
      { text: "both started" },
    ]);
    client.prompt("start them");
    await client.waitForEntry(isResult, "the turn's result");

    // The turn is over and Idle, and the tasks go on: they are what is still running.
    await pollUntil(() => client.taskIds.join() === "survey,dev", {
      description: "both tasks in the status",
    });
    expect(client.status?.state).toBe("idle");
    expect(client.status?.tasks).toEqual([
      { id: "survey", kind: "subagent", description: "Survey the tests" },
      { id: "dev", kind: "background", description: "pnpm dev" },
    ]);
    await pollUntil(() => other.taskIds.join() === "survey,dev", {
      description: "the other client to see them too",
    });
    // What the server reports of the Agent carries them, for Open in terminal to list.
    const listed = await pollUntil(
      () => events.snapshots.map(agentOf).findLast((a) => a?.tasks?.length === 2),
      { description: "both tasks in the state snapshot" },
    );
    expect(listed?.tasks?.map((task) => task.id)).toEqual(["survey", "dev"]);
    // A client that connects later hears them in its first status.
    const late = await server.openAgent(session.id);
    await pollUntil(() => late.taskIds.join() === "survey,dev", {
      description: "a client that connects later to hear them",
    });

    // Stop on the subagent ends that one and leaves the background command running.
    client.stopTask("survey");
    await pollUntil(() => client.taskIds.join() === "dev", {
      description: "only the command left",
    });
    expect(stopped(fakeClaude)).toEqual(["survey"]);
    const notified = client.entries.flatMap((entry) =>
      entry.kind === "sdk" &&
      entry.message.type === "system" &&
      entry.message.subtype === "task_notification"
        ? [`${entry.message.task_id}:${entry.message.status}`]
        : [],
    );
    expect(notified).toEqual(["survey:stopped"]);

    // A task that finishes by itself leaves the list too.
    fakeClaude.endTask("dev");
    await pollUntil(
      () => client.taskIds.length === 0 && client.status?.tasks === undefined,
      {
        description: "no task left",
      },
    );
    expect(stopped(fakeClaude)).toEqual(["survey"]);
    await pollUntil(
      () => agentOf(events.snapshots.at(-1) as Snapshot)?.tasks === undefined,
      {
        description: "none in the state snapshot",
      },
    );
  });

  it("a foreground subagent is listed while it blocks its turn and gone when the turn ends; its messages after a turn ended do not make the Agent Working", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    fakeClaude.script([
      {
        tool: { name: "Agent", input: { description: "Dig" }, id: "toolu_dig" },
        task: { id: "dig", description: "Dig" },
        hold: "dig",
        result: "dug",
      },
      { text: "done" },
    ]);
    client.prompt("dig");
    await pollUntil(() => client.taskIds.join() === "dig", {
      description: "the foreground subagent in the status",
    });
    expect(client.status?.tasks?.[0]?.kind).toBe("subagent");
    fakeClaude.release("dig");
    await client.waitForEntry(isResult, "the turn's result");
    await pollUntil(() => client.status?.tasks === undefined, {
      description: "the subagent gone with its turn",
    });

    // A background subagent's own messages can arrive after the turn's result: they are not a
    // turn, so the Agent stays Idle.
    fakeClaude.script([
      {
        task: { id: "bg", description: "Watch", background: true },
      },
      { text: "started" },
    ]);
    client.prompt("watch");
    await pollUntil(() => client.entries.filter(isResult).length === 2, {
      description: "the second turn's result",
    });
    fakeClaude.say({
      type: "assistant",
      parent_tool_use_id: "toolu_bg",
      message: { role: "assistant", content: [{ type: "text", text: "inner" }] },
    });
    fakeClaude.say({
      type: "tool_progress",
      tool_use_id: "toolu_inner",
      tool_name: "Grep",
      parent_tool_use_id: "toolu_bg",
      task_id: "bg",
      elapsed_time_seconds: 3,
    });
    fakeClaude.endTask("bg");
    await pollUntil(() => client.status?.tasks === undefined, {
      description: "the background task gone",
    });
    expect(client.status?.state).toBe("idle");
  });
});
