// Issue #178: subagent messages, file restore (`rewindFiles`) and Ctrl+B (`backgroundTasks`)
// on a live `Query`. Three scenarios and five checks, added to the live check on a research
// branch. Every fact is a label, a count or a size: the files the model writes hold only the
// script's own tokens (v1, v2, ...), and paths are reduced to basenames or redacted shapes.
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";
import {
  type AgentDefinition,
  getSubagentMessages,
  listSubagents,
} from "@anthropic-ai/claude-agent-sdk";
import { redactText } from "./privacy.ts";
import { BASH_COMMAND, put, SUBAGENT_TOOLS } from "./scenarios.ts";
import {
  blocks,
  isResult,
  isSystem,
  type LiveSession,
  type Msg,
  toolCalls,
} from "./session.ts";
import type { Check, Ctx, EvalContext, Outcome, Scenario } from "./types.ts";

/** The Bash command the restore check runs: a file Write made, changed, and a file Bash alone makes. */
export const REWIND_BASH = "printf 'v2\\n' > a.txt && printf 'b\\n' > b.txt";
const PROBE_LINE = "kb-probe-first-line";

const AGENTS: Record<string, AgentDefinition> = {
  "kb-writer": {
    description: "Writes one file. Use it only when asked to use kb-writer.",
    prompt:
      "Use the Write tool exactly once to create the file the task names, with the content it gives. Then reply only DONE.",
    tools: ["Write"],
    model: "haiku",
  },
  "kb-reader": {
    description: "Reads one file. Use it only when asked to use kb-reader.",
    prompt:
      "Use the Read tool exactly once on the file the task names, then reply with its first line only.",
    tools: ["Read"],
    model: "haiku",
  },
  "kb-sleeper": {
    description: "Runs one fixed command. Use it only when asked to use kb-sleeper.",
    prompt: `Call the Bash tool exactly once with the command \`${BASH_COMMAND}\`, in the foreground (do not set run_in_background). Then reply with its output only.`,
    tools: ["Bash"],
    model: "haiku",
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The prompt that starts one foreground writer and one background reader. */
function twoSubagents(folder: string, file: string): string {
  return [
    "Make exactly two Agent tool calls, both in the same message:",
    `(1) subagent_type kb-writer, run_in_background false, prompt: "Create ${join(folder, file)} containing the single line sub";`,
    `(2) subagent_type kb-reader, run_in_background true, prompt: "Read ${join(folder, "probe.txt")} and report its first line".`,
    "Once kb-writer has finished, reply only OK. Do not wait for kb-reader.",
  ].join(" ");
}

/** What the files of the throwaway folder hold: the script's own tokens, or absent. */
function disk(ctx: Ctx, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const path = join(ctx.run.folder, name);
    out[name] = existsSync(path)
      ? readFileSync(path, "utf8").trim().slice(0, 40)
      : "absent";
  }
  return out;
}

/** A path as a shape: redacted, with conversation and task IDs replaced. */
function pathShape(ctx: Ctx, path: string): string {
  return redactText(path, ctx.run.places)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<session>")
    .replace(/(agent-|tasks\/)[\w-]+/g, "$1<id>")
    .replace(/\/[a-z0-9]{8,}(\.output)$/, "/<id>$1");
}

/** What a task's `output_file` is: where (as a shape), how big, of what format. Never its text. */
function describeOutput(ctx: Ctx, path: string): Record<string, unknown> {
  if (!existsSync(path)) return { where: pathShape(ctx, path), exists: false };
  const link = lstatSync(path).isSymbolicLink();
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let jsonLines = 0;
  const types = new Set<string>();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      jsonLines += 1;
      if (isObject(parsed) && typeof parsed.type === "string") types.add(parsed.type);
    } catch {
      // Plain text.
    }
  }
  return {
    where: pathShape(ctx, path),
    exists: true,
    symlink: link,
    ...(link ? { target: pathShape(ctx, readlinkSync(path)) } : {}),
    bytes: Buffer.byteLength(text),
    lines: lines.length,
    jsonLines,
    types: [...types],
    holdsBashMarker: text.includes("kb-livecheck-done"),
    holdsProbeLine: text.includes(PROBE_LINE),
  };
}

/** What `getSubagentMessages` and `listSubagents` give for a conversation's subagents. */
async function storedSubagents(
  ctx: Ctx,
  sessionId: string,
  agentIds: readonly string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const listed = await listSubagents(sessionId, { dir: ctx.run.folder });
    out.listed = listed.length;
    out.listedIncludes = agentIds.map((id) => listed.includes(id));
  } catch (error) {
    out.listError = String(error).slice(0, 120);
  }
  for (const id of agentIds) {
    try {
      const msgs = (await getSubagentMessages(sessionId, id, {
        dir: ctx.run.folder,
      })) as unknown as Msg[];
      out[`messages:${id}`] = {
        count: msgs.length,
        bytes: msgs.reduce((n, m) => n + JSON.stringify(m).length, 0),
        shapes: msgs.map(shapeOf),
      };
    } catch (error) {
      out[`messages:${id}`] = { error: String(error).slice(0, 120) };
    }
  }
  return out;
}

/** `assistant[text,tool_use]`, `user[tool_result]`, `stream_event`, ... */
export function shapeOf(m: Msg): string {
  if (m.type !== "assistant" && m.type !== "user")
    return `${m.type}${typeof m.subtype === "string" ? `/${m.subtype}` : ""}`;
  return `${m.type}[${blocks(m)
    .map((b) => String(b.type))
    .join(",")}]`;
}

/** The subagents a span of messages started: tool_use id, task id, type, backgrounded. */
function subagentsIn(msgs: readonly Msg[]) {
  return msgs
    .filter((m) => isSystem(m, "task_started") && m.task_type === "local_agent")
    .map((m) => ({
      taskId: String(m.task_id),
      toolUseId: String(m.tool_use_id ?? ""),
      type: String(m.subagent_type ?? m.description ?? ""),
      backgrounded: m.is_backgrounded === true,
    }));
}

const fakeTimeout = (ctx: Ctx, ms: number) => (ctx.run.fake ? 3000 : ms);

// ---- Scenarios ---------------------------------------------------------------------------

/** One prompt starting a foreground writer and a background reader, with `forwardSubagentText` on. */
export const subagentsScenario: Scenario = {
  name: "subagents",
  budget: 3,
  async run(ctx) {
    const { run } = ctx;
    put(ctx, "probe.txt", `${PROBE_LINE}\nsecond line\n`);
    run.fakeClaude?.script([
      {
        tool: {
          name: "Agent",
          input: { subagent_type: "kb-writer", description: "w", prompt: "x" },
        },
        task: { id: "task-w", description: "w", subagentType: "kb-writer" },
        result: "DONE",
        ask: true,
      },
      { text: "OK" },
    ]);
    const s = ctx.open({
      policy: { subagent: SUBAGENT_TOOLS },
      agents: AGENTS,
      forwardSubagentText: true,
    });
    await probeTwoSubagents(ctx, s, "sub-on.txt", "on");
    await s.close();
  },
};

/** Sends the two-subagent prompt, waits for the background one, and notes what came. */
async function probeTwoSubagents(
  ctx: Ctx,
  s: LiveSession,
  file: string,
  key: string,
): Promise<string> {
  const { cap } = ctx;
  const uuid = randomUUID();
  const from = s.msgs.length;
  await s.turn(twoSubagents(ctx.run.folder, file), { uuid, timeoutMs: 180_000 });
  const started = subagentsIn(s.msgs.slice(from));
  // The background one ends by a task_notification; its report starts a turn nobody sent.
  for (const sub of started.filter((x) => x.backgrounded)) {
    const note = await s.next(
      (m) => isSystem(m, "task_notification") && m.task_id === sub.taskId,
      fakeTimeout(ctx, 120_000),
      from,
    );
    // The turn its report starts (or the running turn's own result, when it came in time).
    if (note) await s.next(isResult, fakeTimeout(ctx, 60_000), s.msgs.indexOf(note));
  }
  await s.settled(fakeTimeout(ctx, 90_000));
  const to = s.msgs.length;
  const msgs = s.msgs.slice(from, to);
  const sessionId = String(
    msgs.find((m) => typeof m.session_id === "string")?.session_id ?? "",
  );
  const outputs: Record<string, unknown> = {};
  for (const m of msgs.filter((x) => isSystem(x, "task_notification"))) {
    outputs[String(m.task_id)] = {
      status: m.status,
      summaryChars: String(m.summary ?? "").length,
      usage: m.usage,
      file:
        typeof m.output_file === "string" ? describeOutput(ctx, m.output_file) : "none",
    };
  }
  cap.notes[`subagents:${key}`] = {
    from,
    to,
    uuid,
    started,
    outputs,
    stored: sessionId
      ? await storedSubagents(
          ctx,
          sessionId,
          started.map((x) => x.taskId),
        )
      : "no session id",
    disk: disk(ctx, [file]),
  };
  return uuid;
}

/** Edits through Write, Bash and a subagent, a queued prompt, a /clear, and rewinds on the live Query. */
export const rewindScenario: Scenario = {
  name: "rewind-files",
  budget: 8,
  async run(ctx) {
    const { run, cap } = ctx;
    const files = ["a.txt", "a2.txt", "b.txt", "sub-off.txt"] as const;
    put(ctx, "probe.txt", `${PROBE_LINE}\nsecond line\n`);
    const s = ctx.open({
      policy: {
        subagent: SUBAGENT_TOOLS,
        ...(run.settings.bashCovered ? {} : { bash: REWIND_BASH }),
      },
      blocked: { bash: true },
      agents: AGENTS,
    });
    const ids = {
      u1: randomUUID(),
      u2: randomUUID(),
      u4: randomUUID(),
      u5: "",
      u6: randomUUID(),
    };
    cap.notes.ids = ids;
    const snapshots: Record<string, Record<string, string>> = {};
    snapshots.start = disk(ctx, files);

    // U1: two Writes; U2 is sent while U1's first tool call waits, to be folded into it.
    run.fakeClaude?.script([
      {
        tool: {
          name: "Write",
          input: { file_path: join(run.folder, "a.txt"), content: "v1\n" },
        },
        hold: "gate",
        ask: true,
      },
      { text: "OK" },
    ]);
    const from1 = s.send(
      `Use the Write tool to create ${join(run.folder, "a.txt")} containing the single line v1. Then use the Write tool to create ${join(run.folder, "a2.txt")} containing the single line x. Then reply OK.`,
      ids.u1,
    );
    const firstTool = await s.next(
      (m) => toolCalls([m]).length > 0 || isResult(m),
      90_000,
      from1,
    );
    cap.notes.u2SentDuringTool = firstTool !== null && !isResult(firstTool);
    s.send("After that, reply with only the word: second", ids.u2);
    run.fakeClaude?.release("gate");
    cap.notes.u1u2Completed = await s.waitForCompleted([ids.u1, ids.u2], from1, 150_000);
    cap.notes.u1u2Results = s.msgs.slice(from1).filter(isResult).length;
    snapshots.afterU1 = disk(ctx, files);

    // U4: Bash changes a.txt (which Write made) and makes b.txt.
    if (!run.settings.bashCovered) {
      run.fakeClaude?.script([
        { tool: { name: "Bash", input: { command: REWIND_BASH } }, ask: true },
        { text: "DONE" },
      ]);
      await s.turn(
        `Call the Bash tool exactly once with the command \`${REWIND_BASH}\` (run it in the working directory, foreground). Then reply only DONE.`,
        { uuid: ids.u4 },
      );
    } else {
      cap.notes.bashSkipped = true;
      await s.turn(`Reply with the single word: skip`, { uuid: ids.u4 });
    }
    snapshots.afterU4 = disk(ctx, files);

    // U5: a foreground subagent writes sub-off.txt, a background one reads.
    run.fakeClaude?.script([{ text: "OK" }]);
    ids.u5 = await probeTwoSubagents(ctx, s, "sub-off.txt", "off");
    snapshots.afterU5 = disk(ctx, files);

    // Dry runs on the live Query, then a real rewind to U4 (before Bash and the subagents).
    const rewind = async (id: string, dryRun: boolean) => {
      try {
        const r = (await s.q.rewindFiles(id, { dryRun })) as unknown as Record<
          string,
          unknown
        >;
        return {
          canRewind: r.canRewind,
          ...(r.error
            ? { error: redactText(String(r.error), run.places).slice(0, 160) }
            : {}),
          files: Array.isArray(r.filesChanged)
            ? (r.filesChanged as unknown[]).map((f) => basename(String(f))).sort()
            : r.filesChanged,
          insertions: r.insertions,
          deletions: r.deletions,
          ...(r.skippedLinks !== undefined ? { skippedLinks: r.skippedLinks } : {}),
          keys: Object.keys(r).sort(),
        };
      } catch (error) {
        return { threw: redactText(String(error), run.places).slice(0, 160) };
      }
    };
    const named = { u1: ids.u1, u2: ids.u2, u4: ids.u4, u5: ids.u5 };
    const dry: Record<string, unknown> = {};
    for (const [label, id] of Object.entries(named)) dry[label] = await rewind(id, true);
    cap.notes.dryBefore = dry;
    cap.notes.realU4 = await rewind(ids.u4, false);
    snapshots.afterRewindU4 = disk(ctx, files);
    // A dry run straight after the real rewind: is there anything left to restore?
    cap.notes.dryU4Again = await rewind(ids.u4, true);

    // A later turn edits the restored file: does it see v1?
    run.fakeClaude?.script([
      {
        tool: {
          name: "Edit",
          input: {
            file_path: join(run.folder, "a.txt"),
            old_string: "v1",
            new_string: "v3",
          },
        },
        ask: true,
      },
      { text: "v3" },
    ]);
    const from6 = s.msgs.length;
    await s.turn(
      `Use the Edit tool to replace the text v1 with v3 in ${join(run.folder, "a.txt")}. Then reply only with the line that file now holds.`,
      { uuid: ids.u6 },
    );
    const turn6 = s.msgs.slice(from6);
    cap.notes.laterTurn = {
      tools: toolCalls(turn6).map((c) => c.name),
      toolErrors: turn6
        .filter((m) => m.type === "user")
        .flatMap((m) => blocks(m))
        .filter((b) => b.type === "tool_result" && b.is_error === true)
        .map((b) =>
          redactText(
            typeof b.content === "string" ? b.content : JSON.stringify(b.content),
            run.places,
          ).slice(0, 160),
        ),
      reply: turn6
        .filter((m) => m.type === "assistant")
        .flatMap((m) => blocks(m))
        .filter((b) => b.type === "text")
        .map((b) => String(b.text).trim())
        .join(" ")
        .slice(0, 40),
    };
    snapshots.afterLaterTurn = disk(ctx, files);

    // /clear, then dry runs on the prompts above it, and a real rewind to U1.
    const fromClear = s.msgs.length;
    await s.turn("/clear");
    cap.notes.clearResults = s.msgs.slice(fromClear).filter(isResult).length;
    const dryAfter: Record<string, unknown> = {};
    for (const [label, id] of Object.entries({ ...named, u6: ids.u6 }))
      dryAfter[label] = await rewind(id, true);
    cap.notes.dryAfterClear = dryAfter;
    cap.notes.realU1AfterClear = await rewind(ids.u1, false);
    snapshots.afterRewindU1 = disk(ctx, files);
    cap.notes.snapshots = snapshots;
    await s.close();
  },
};

/** `backgroundTasks()` on a running foreground Bash, then on a foreground subagent. */
export const ctrlBScenario: Scenario = {
  name: "ctrl-b",
  budget: 4,
  async run(ctx) {
    const { run, cap } = ctx;
    if (run.settings.bashCovered) {
      cap.notes.bashSkipped = true;
      return;
    }
    const s = ctx.open({
      policy: { subagent: SUBAGENT_TOOLS, bash: BASH_COMMAND },
      blocked: { bash: true },
      agents: AGENTS,
    });

    /** Waits for the foreground Bash task, gives it a moment, backgrounds it and notes what follows. */
    const background = async (key: string, prompt: string, byToolUse: boolean) => {
      const uuid = randomUUID();
      const from = s.send(prompt, uuid);
      // Claude Code runs `sleep; echo` without asking (no canUseTool), so the cue is the
      // foreground `local_bash` task itself: the Bash call, or the subagent's own Bash.
      const running = await s.next(
        (m) =>
          isSystem(m, "task_started") &&
          m.task_type === "local_bash" &&
          m.is_backgrounded !== true,
        fakeTimeout(ctx, 120_000),
        from,
      );
      if (!running || s.msgs.slice(s.msgs.indexOf(running)).some(isResult)) {
        cap.notes[key] = {
          provoked: false,
          tools: toolCalls(s.msgs.slice(from)).map((c) => c.name),
        };
        await s.waitForCompleted([uuid], from, 120_000);
        return;
      }
      await wait(run.fake ? 200 : 4000);
      // The tool call the turn is blocked on: the Bash call, or the Agent call.
      const blocking = toolCalls(s.msgs.slice(from)).find((c) =>
        key === "bash" ? c.name === "Bash" : SUBAGENT_TOOLS.includes(c.name as never),
      );
      const atCall = s.msgs.length;
      const listedBefore = s.msgs
        .slice(from, atCall)
        .filter((m) => isSystem(m, "task_started"))
        .map((m) => ({ type: m.task_type, backgrounded: m.is_backgrounded }));
      // While the turn runs: is rewindFiles answered mid-turn (dry, then real, on this prompt)?
      if (key === "bash") {
        const midTurn: Record<string, unknown> = {};
        for (const dryRun of [true, false]) {
          const t = Date.now();
          try {
            const r = (await s.q.rewindFiles(uuid, { dryRun })) as unknown as Msg;
            midTurn[dryRun ? "dry" : "real"] = { ...r, ms: Date.now() - t };
          } catch (error) {
            midTurn[dryRun ? "dry" : "real"] = {
              threw: redactText(String(error), run.places).slice(0, 160),
              ms: Date.now() - t,
            };
          }
        }
        midTurn.turnStillRunning = !s.msgs.slice(from).some(isResult);
        cap.notes.rewindMidTurn = midTurn;
      }
      const t0 = Date.now();
      let returned: unknown;
      try {
        returned = await (byToolUse && blocking
          ? s.q.backgroundTasks(blocking.id)
          : s.q.backgroundTasks());
      } catch (error) {
        returned = { threw: redactText(String(error), run.places).slice(0, 160) };
      }
      run.fakeClaude?.release(key);
      const resultFor = (m: Msg) =>
        m.type === "user" &&
        blocks(m).some((b) => b.type === "tool_result" && b.tool_use_id === blocking?.id);
      const toolResult = await s.next(resultFor, fakeTimeout(ctx, 60_000), from);
      const toolResultMs = Date.now() - t0;
      const completed = await s.waitForCompleted([uuid], from, fakeTimeout(ctx, 120_000));
      const turnEndMs = Date.now() - t0;
      const turnEnd = s.msgs.length;
      const notification = await s.next(
        (m) => isSystem(m, "task_notification"),
        fakeTimeout(ctx, 90_000),
        atCall,
      );
      const notificationMs = Date.now() - t0;
      const after = s.msgs.slice(atCall);
      const tr = toolResult
        ? blocks(toolResult).find(
            (b) => b.type === "tool_result" && b.tool_use_id === blocking?.id,
          )
        : undefined;
      const trText = tr
        ? typeof tr.content === "string"
          ? tr.content
          : JSON.stringify(tr.content)
        : "";
      cap.notes[key] = {
        provoked: true,
        byToolUse: byToolUse && blocking !== undefined,
        tasksBeforeCall: listedBefore,
        returned,
        toolResultMs: toolResult ? toolResultMs : null,
        toolResultText: redactText(trText, run.places)
          .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>")
          .replace(/\b(?=[a-z]*[0-9])[a-z0-9]{9,}\b/g, "<id>")
          .slice(0, 240),
        toolResultIsError: tr?.is_error === true,
        toolUseResultKeys: isObject(toolResult?.tool_use_result)
          ? Object.keys(toolResult.tool_use_result).sort()
          : [],
        toolUseResultStatus: isObject(toolResult?.tool_use_result)
          ? toolResult.tool_use_result.status
          : undefined,
        turnCompleted: completed === 1,
        turnEndMs,
        resultBeforeNotification:
          notification !== null &&
          s.msgs.slice(from, s.msgs.indexOf(notification)).some(isResult),
        afterCall: [...new Set(after.slice(0, turnEnd - atCall).map(shapeOf))],
        taskEvents: after
          .filter(
            (m) =>
              isSystem(m, "task_started") ||
              isSystem(m, "task_updated") ||
              isSystem(m, "background_tasks_changed") ||
              isSystem(m, "task_notification"),
          )
          .map((m) =>
            isSystem(m, "task_started")
              ? `task_started(${String(m.task_type)}, backgrounded=${String(m.is_backgrounded)})`
              : isSystem(m, "task_updated")
                ? `task_updated(${JSON.stringify(m.patch ?? {})})`
                : isSystem(m, "background_tasks_changed")
                  ? `background_tasks_changed(${Array.isArray(m.tasks) ? m.tasks.length : "?"})`
                  : `task_notification(${String(m.status)})`,
          ),
        notification: notification
          ? {
              ms: notificationMs,
              status: notification.status,
              namesTheToolUse: notification.tool_use_id === blocking?.id,
              file:
                typeof notification.output_file === "string"
                  ? describeOutput(ctx, notification.output_file)
                  : "none",
            }
          : null,
      };
    };

    run.fakeClaude?.script([
      {
        tool: { name: "Bash", input: { command: BASH_COMMAND } },
        task: { id: "task-b1", type: "bash", description: "sleep" },
        hold: "bash",
        ask: true,
        result: "done",
      },
      { text: "FINISHED" },
    ]);
    await background(
      "bash",
      `Call the Bash tool exactly once with the command \`${BASH_COMMAND}\`, in the foreground (run_in_background false). Then reply only FINISHED.`,
      false,
    );
    // The notification starts a turn nobody sent: let it end before the next prompt.
    const note = s.msgs.findLastIndex((m) => isSystem(m, "task_notification"));
    if (note >= 0) await s.next(isResult, fakeTimeout(ctx, 60_000), note);
    await s.settled(fakeTimeout(ctx, 90_000));

    run.fakeClaude?.script([
      {
        tool: {
          name: "Agent",
          input: { subagent_type: "kb-sleeper", description: "s", prompt: "x" },
        },
        task: { id: "task-s", description: "s", subagentType: "kb-sleeper" },
        result: "done",
      },
      {
        tool: { name: "Bash", input: { command: BASH_COMMAND } },
        task: { id: "task-b2", type: "bash", description: "sleep" },
        hold: "agent",
        ask: true,
        result: "done",
      },
      { text: "FINISHED" },
    ]);
    await background(
      "agent",
      "Use the Agent tool exactly once with subagent_type kb-sleeper, run_in_background false, and the prompt 'Run your command'. Then reply only FINISHED.",
      true,
    );
    await s.close();
  },
};

// ---- Checks ------------------------------------------------------------------------------

const pass = (reason: string, facts: string[]): Outcome => ({
  verdict: "PASS",
  reason,
  facts,
});
const fail = (reason: string, facts: string[]): Outcome => ({
  verdict: "FAIL",
  reason,
  facts,
});
const notProvoked = (reason: string, facts: string[] = []): Outcome => ({
  verdict: "NOT PROVOKED",
  reason,
  facts,
});
const j = (value: unknown) => JSON.stringify(value);

type SubagentNote = {
  from: number;
  to: number;
  started: ReturnType<typeof subagentsIn>;
  outputs: Record<string, unknown>;
  stored: unknown;
  disk: Record<string, string>;
};

/** Facts about the subagent frames (`parent_tool_use_id` set) of one probe. */
function subagentFacts(session: LiveSession, note: SubagentNote, label: string) {
  const msgs = session.msgs.slice(note.from, note.to);
  const facts: string[] = [];
  const findings: Array<{
    backgrounded: boolean;
    text: boolean;
    agentIdOk: boolean;
    count: number;
  }> = [];
  for (const sub of note.started) {
    const mine = msgs.filter((m) => m.parent_tool_use_id === sub.toolUseId);
    const nonStream = mine.filter((m) => m.type !== "stream_event");
    const shapes = new Map<string, number>();
    for (const m of mine) shapes.set(shapeOf(m), (shapes.get(shapeOf(m)) ?? 0) + 1);
    const bytes = nonStream.reduce((n, m) => n + JSON.stringify(m).length, 0);
    const streamBytes = mine
      .filter((m) => m.type === "stream_event")
      .reduce((n, m) => n + JSON.stringify(m).length, 0);
    const agentIds = new Set(nonStream.map((m) => m.agent_id));
    const agentIdOk =
      nonStream.length > 0 && agentIds.size === 1 && agentIds.has(sub.taskId);
    const text = nonStream.some((m) =>
      blocks(m).some((b) => b.type === "text" || b.type === "thinking"),
    );
    const models = [
      ...new Set(
        nonStream
          .filter((m) => m.type === "assistant" && isObject(m.message))
          .map((m) => String((m.message as Msg).model)),
      ),
    ];
    findings.push({
      backgrounded: sub.backgrounded,
      text,
      agentIdOk,
      count: nonStream.length,
    });
    facts.push(
      `${label}, ${sub.type} (${sub.backgrounded ? "background" : "foreground"}): ${nonStream.length} messages with parent_tool_use_id (${bytes} bytes), ${mine.length - nonStream.length} stream_event (${streamBytes} bytes); shapes ${[...shapes].map(([k, n]) => `${k}×${n}`).join(", ") || "none"}; agent_id equals the task_id on each: ${agentIdOk ? "yes" : `no (${[...agentIds].map((x) => (x === sub.taskId ? "task_id" : x === undefined ? "absent" : "other")).join(", ")})`}; text or thinking blocks: ${text ? "yes" : "no"}; models ${models.map((x) => (/haiku/i.test(x) ? "haiku" : x)).join(", ") || "none"}`,
    );
    const out = note.outputs[sub.taskId];
    facts.push(
      `${label}, ${sub.type}: task_notification ${out ? j(out) : "none in the window"}`,
    );
  }
  facts.push(`${label}: stored transcripts ${j(note.stored)}`);
  return { facts, findings };
}

export const subagentMessagesCheck: Check = {
  name: "subagent-messages",
  row: "A3",
  title:
    "Subagent frames with and without forwardSubagentText, getSubagentMessages, listSubagents, task_notification.output_file",
  scenario: "subagents",
  fakeCannot: "the fake sends no subagent frames",
  assumption:
    "web/src/agent/items.ts (drops every message with parent_tool_use_id); src/agent-runtime/session.ts (forwardSubagentText unset); sdk.d.ts forwardSubagentText docs",
  evaluate({ cap, all }: EvalContext): Outcome {
    const on = cap.notes["subagents:on"] as SubagentNote | undefined;
    const offCap = all.get("rewind-files");
    const off = offCap?.notes["subagents:off"] as SubagentNote | undefined;
    const facts: string[] = [];
    const results: Array<{
      forward: boolean;
      f: ReturnType<typeof subagentFacts>["findings"];
    }> = [];
    if (on && cap.sessions[0]) {
      const r = subagentFacts(cap.sessions[0], on, "forwardSubagentText on");
      facts.push(...r.facts);
      results.push({ forward: true, f: r.findings });
    }
    if (off && offCap?.sessions[0]) {
      const r = subagentFacts(offCap.sessions[0], off, "forwardSubagentText off");
      facts.push(...r.facts);
      results.push({ forward: false, f: r.findings });
    }
    const all4 = results.flatMap((r) => r.f);
    if (all4.length === 0) return notProvoked("no subagent was started", facts);
    const offText = results
      .filter((r) => !r.forward)
      .flatMap((r) => r.f)
      .some((x) => x.text);
    const onText = results
      .filter((r) => r.forward)
      .flatMap((r) => r.f)
      .some((x) => x.text);
    const badIds = all4.some((x) => x.count > 0 && !x.agentIdOk);
    if (offText)
      return fail(
        "with forwardSubagentText off, subagent text or thinking still arrived",
        facts,
      );
    if (badIds) return fail("a subagent frame's agent_id is not its task_id", facts);
    if (results.some((r) => r.forward) && !onText)
      return fail("with forwardSubagentText on, no subagent text arrived", facts);
    return pass(
      "off: only tool_use/tool_result frames; on: the subagent's text too; agent_id is the task_id",
      facts,
    );
  },
};

export const subagentAskCheck: Check = {
  name: "subagent-ask",
  row: "A3",
  title: "A subagent's permission ask names the subagent (canUseTool agentID)",
  scenario: "subagents",
  fakeCannot: "the fake's asks carry no agentID",
  assumption: "src/agent-runtime/asks.ts logs agentId; nothing in the browser shows it",
  evaluate({ cap, all }: EvalContext): Outcome {
    const facts: string[] = [];
    let named = 0;
    let unnamed = 0;
    for (const [scenario, captured] of [
      ["subagents", cap],
      ["rewind-files", all.get("rewind-files")],
      ["ctrl-b", all.get("ctrl-b")],
    ] as const) {
      const session = captured?.sessions[0];
      if (!session) continue;
      const taskIds = new Set(subagentsIn(session.msgs).map((x) => x.taskId));
      const mainToolUses = new Set(
        session.msgs
          .filter((m) => m.type === "assistant" && m.parent_tool_use_id == null)
          .flatMap((m) => toolCalls([m]).map((c) => c.id)),
      );
      for (const ask of session.asks) {
        const fromSub = ask.toolUseId !== undefined && !mainToolUses.has(ask.toolUseId);
        if (!fromSub && ask.agentId === undefined) continue;
        const ok = ask.agentId !== undefined && taskIds.has(ask.agentId);
        if (ok) named += 1;
        else unnamed += 1;
        facts.push(
          `${scenario}: a subagent's ${ask.toolName} ask: agentID ${ask.agentId === undefined ? "absent" : taskIds.has(ask.agentId) ? "= the subagent's task_id (and agent_id)" : "set, matching no task"}`,
        );
      }
      facts.push(
        `${scenario}: main-thread asks carry no agentID: ${session.asks.filter((a) => a.toolUseId !== undefined && mainToolUses.has(a.toolUseId)).every((a) => a.agentId === undefined) ? "yes" : "no"}`,
      );
    }
    if (named + unnamed === 0)
      return notProvoked("no subagent asked for a permission", facts);
    return unnamed === 0
      ? pass("every subagent ask carried agentID, equal to the subagent's task_id", facts)
      : fail("a subagent ask came without a matching agentID", facts);
  },
};

export const rewindFilesCheck: Check = {
  name: "rewind-files",
  row: "A3",
  title:
    "rewindFiles on a live Query: dry run, real restore, a queued prompt, a prompt above /clear, Bash and subagent edits, a later turn",
  scenario: "rewind-files",
  fakeCannot: "the fake answers rewind_files with nothing",
  assumption:
    "src/agent-runtime/session.ts enableFileCheckpointing + prompt id = message uuid; file-checkpointing.md",
  evaluate({ cap }: EvalContext): Outcome {
    const n = cap.notes;
    if (!n.snapshots) return notProvoked("the scenario did not reach its rewinds");
    const snaps = n.snapshots as Record<string, Record<string, string>>;
    const facts = [
      `the queued prompt was sent during U1's tool call: ${String(n.u2SentDuringTool)}; prompts completed ${String(n.u1u2Completed)} of 2 with ${String(n.u1u2Results)} result(s)`,
      `Bash part: ${n.bashSkipped ? "skipped (the owner's settings allow Bash broadly)" : "run"}`,
      `disk: ${Object.entries(snaps)
        .map(([k, v]) => `${k} ${j(v)}`)
        .join("; ")}`,
      `dry runs before /clear: ${j(n.dryBefore)}`,
      `real rewind to U4 (before the Bash edit and the subagents): ${j(n.realU4)}`,
      `dry run to U4 again right after: ${j(n.dryU4Again)}`,
      `a later turn editing a.txt: ${j(n.laterTurn)}`,
      `/clear gave ${String(n.clearResults)} result(s)`,
      `dry runs after /clear: ${j(n.dryAfterClear)}`,
      `real rewind to U1 after /clear: ${j(n.realU1AfterClear)}`,
    ];
    const restored = snaps.afterRewindU4?.["a.txt"] === "v1";
    if ((n.realU4 as { canRewind?: boolean } | undefined)?.canRewind !== true)
      return fail("the real rewind on the live Query was refused", facts);
    return restored
      ? pass(
          "a real rewind on the live Query, without a restart, restored the file Write made",
          facts,
        )
      : fail("the rewind said it could, but a.txt was not restored", facts);
  },
};

function ctrlBOutcome(
  cap: EvalContext["cap"],
  key: "bash" | "agent",
  what: string,
): Outcome {
  if (cap.notes.bashSkipped)
    return notProvoked("the owner's settings allow Bash broadly, so Bash is not used");
  const n = cap.notes[key] as Record<string, unknown> | undefined;
  if (!n) return notProvoked("the scenario did not reach it");
  const facts = Object.entries(n).map(([k, v]) => `${k}: ${j(v)}`);
  if (key === "bash" && cap.notes.rewindMidTurn)
    facts.push(`rewindFiles mid-turn: ${j(cap.notes.rewindMidTurn)}`);
  if (n.provoked !== true) return notProvoked(`the model did not run the ${what}`, facts);
  if (n.returned !== true)
    return fail(`backgroundTasks did not return true for the ${what}`, facts);
  if (n.turnCompleted !== true)
    return fail("the turn did not carry on to its end", facts);
  if (n.notification === null)
    return fail("no task_notification followed within 90 s of backgrounding", facts);
  return n.resultBeforeNotification === true
    ? pass(
        `the ${what} went to the background and the turn ended before the task did`,
        facts,
      )
    : fail("the turn ended only after the task: it was not backgrounded", facts);
}

export const ctrlBBashCheck: Check = {
  name: "ctrl-b-bash",
  row: "A3",
  title:
    "backgroundTasks() with no tool_use id (Ctrl+B) on a running foreground Bash command; rewindFiles mid-turn",
  scenario: "ctrl-b",
  fakeCannot: "the fake answers background_tasks with nothing",
  assumption: "not called by k-bench (gap analysis: no Ctrl+B)",
  evaluate: ({ cap }) => ctrlBOutcome(cap, "bash", "foreground Bash command"),
};

export const ctrlBAgentCheck: Check = {
  name: "ctrl-b-agent",
  row: "A3",
  title: "backgroundTasks(the Agent call's tool_use id) on a running foreground subagent",
  scenario: "ctrl-b",
  fakeCannot: "the fake answers background_tasks with nothing",
  assumption: "not called by k-bench (gap analysis: no Ctrl+B)",
  evaluate: ({ cap }) => ctrlBOutcome(cap, "agent", "foreground subagent"),
};
