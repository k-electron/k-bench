// What the live check does with a Claude Code, one scenario at a time: the prompts it sends and
// what it keeps. Judging what was seen is `checks.ts`. With `--fake` each scenario first
// scripts the fake Claude to say what k-bench's code assumes the real one says, so the checks
// run on something; that proves the script, not `claude`.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeStep } from "../../test/harness/fake-claude.ts";
import { isInside } from "./rails.ts";
import { isResult, isSystem, type LiveSession, type Msg, toolCalls } from "./session.ts";
import { terminalScenario } from "./terminal.ts";
import type { Ctx, Scenario } from "./types.ts";

/** The one Bash command the check that needs Bash allows, exactly. */
export const BASH_COMMAND = "sleep 20; echo kb-livecheck-done";
export const SUBAGENT_TOOLS = ["Agent", "Task"] as const;
const PONG = "Reply with the single word: pong";

const script = (ctx: Ctx, steps: FakeStep[]) => ctx.run.fakeClaude?.script(steps);

/** Writes a file in the throwaway folder. */
export function put(ctx: Ctx, name: string, text: string): string {
  const path = join(ctx.run.folder, name);
  writeFileSync(path, text);
  return path;
}

const baseline: Scenario = {
  name: "baseline",
  budget: 4,
  async run(ctx) {
    const { run, cap } = ctx;
    const s = ctx.open({});
    // Nothing is sent yet: the reply to the SDK's first request, which costs no turn.
    cap.notes.initReply = await s.q.initializationResult();
    cap.notes.account = await s.q.accountInfo();
    if (run.fake && run.fakeClaude && ctx.extras.breakMode === "settings") {
      // What a script that forgot the rails would do: `/advisor` writes the owner's default.
      await s.turn("/advisor opus");
    }
    await s.turn(PONG);
    cap.notes.firstInit = s.init;
    try {
      cap.notes.context = await s.q.getContextUsage();
    } catch (error) {
      cap.notes.contextError = String(error).slice(0, 120);
    }
    try {
      await s.q.setPermissionMode("auto");
      cap.notes.autoAccepted = true;
      await s.q.setPermissionMode("default");
    } catch (error) {
      cap.notes.autoAccepted = false;
      cap.notes.autoError = String(error).slice(0, 120);
    }
    cap.notes.modelFrom = s.msgs.length;
    await s.turn("/model haiku");
    cap.notes.unavailableFrom = s.msgs.length;
    script(ctx, [{ commandReply: "/plugin isn't available in this environment." }]);
    await s.turn("/plugin");
    cap.notes.unavailableTo = s.msgs.length;
    await s.close();
  },
};

const plan: Scenario = {
  name: "plan",
  budget: 2,
  async run(ctx) {
    const { run, cap } = ctx;
    const planFile = join(run.configDir, "plans", `kb-livecheck-${run.id}.md`);
    if (run.fake) {
      mkdirSync(join(run.configDir, "plans"), { recursive: true });
      writeFileSync(planFile, `Plan: create plan-check.txt in ${run.folder}\n`);
      script(ctx, [
        { text: "Here is the plan." },
        {
          tool: {
            name: "ExitPlanMode",
            input: {
              plan: `Create plan-check.txt in ${run.folder}`,
              planFilePath: planFile,
            },
          },
          ask: true,
        },
        { mode: "default" },
        { text: "Approved, done." },
      ]);
    }
    const s = ctx.open({
      permissionMode: "plan",
      // The plan file lives in Claude Code's own folder, so writing it is allowed there too.
      policy: { allow: ["ExitPlanMode"], alsoFolders: [join(run.configDir, "plans")] },
      onAsk(tool, input) {
        // A plan file this run made: named by its own ExitPlanMode, or written by the model.
        const file = tool === "ExitPlanMode" ? input.planFilePath : input.file_path;
        if (
          typeof file === "string" &&
          (tool === "ExitPlanMode" || tool === "Write" || tool === "Edit") &&
          isInside(join(run.configDir, "plans"), file)
        ) {
          run.reportedPlans.push(file);
        }
      },
    });
    cap.notes.from = s.msgs.length;
    await s.turn(
      `Plan this, then ask me to approve the plan: create a file plan-check.txt in the working directory (${run.folder}) containing the single word approved. Keep the plan to one line and name the working directory in it.`,
      { timeoutMs: 150_000 },
    );
    await s.close();
  },
};

const focus: Scenario = {
  name: "focus",
  budget: 2,
  async run(ctx) {
    const s = ctx.open({ launch: { focusView: true } });
    await s.turn(PONG);
    await s.close();
  },
};

const ADVISOR_ASK =
  "Is a tool named exactly 'advisor' available to you right now? Answer only yes or no.";

const advisor: Scenario = {
  name: "advisor",
  budget: 3,
  fakeCannot: "the fake has no advisor tool to switch on or off",
  async run(ctx) {
    // The advisor on (`--advisor opus`, which the advisor tool itself runs on): never called here.
    const on = ctx.open({ launch: { advisor: "opus" }, advisorOff: false });
    await on.turn(ADVISOR_ASK);
    await on.close();
    // The same flag with the environment's off switch.
    const off = ctx.open({ launch: { advisor: "opus" }, advisorOff: true });
    await off.turn(ADVISOR_ASK);
    await off.close();
  },
};

const clear: Scenario = {
  name: "clear",
  budget: 4,
  async run(ctx) {
    const { cap } = ctx;
    const s = ctx.open({ policy: { allow: ["TodoWrite"] } });
    script(ctx, [
      {
        tool: {
          name: "TodoWrite",
          input: {
            todos: [
              {
                content: "remember PELICAN",
                activeForm: "Remembering",
                status: "pending",
              },
            ],
          },
        },
        ask: true,
      },
      { text: "OK" },
    ]);
    await s.turn(
      "Remember the word PELICAN: use the TodoWrite tool once with a single todo that says so, then reply only OK.",
    );
    cap.notes.clearFrom = s.msgs.length;
    await s.turn("/clear");
    cap.notes.afterClear = s.msgs.length;
    script(ctx, [{ text: "UNKNOWN" }]);
    await s.turn(
      "What word did I ask you to remember? If you don't know, reply only UNKNOWN.",
    );
    await s.close();
  },
};

/** The spellings of a mention of a path with a space that the check tries, each with its file. */
export const SPACE_FORMS = [
  { form: "verbatim", file: "my note.txt", token: "TEAL", mention: "@my note.txt" },
  {
    form: "quoted",
    file: "my quoted note.txt",
    token: "AMBER",
    mention: '@"my quoted note.txt"',
  },
  {
    form: "escaped",
    file: "my escaped note.txt",
    token: "VIOLET",
    mention: "@my\\ escaped\\ note.txt",
  },
] as const;

const atPath: Scenario = {
  name: "at-path",
  budget: 5,
  fakeCannot: "the fake does not expand @path",
  async run(ctx) {
    const { cap } = ctx;
    put(ctx, "note.txt", "The secret fruit is QUINCE.\n");
    for (const { file, token } of SPACE_FORMS)
      put(ctx, file, `The secret word is ${token}.\n`);
    // The model may not read: the answer can only come from what Claude Code put in the prompt.
    const s = ctx.open({ blocked: { noFileTools: true } });
    cap.notes.plainFrom = s.msgs.length;
    await s.turn(
      "What is the secret fruit in @note.txt? Do not use any tools. Reply with just the fruit, or NOFILE if you can't see the file.",
    );
    // What the `@` picker inserts for a path with a space is `@path` verbatim
    // (web/src/agent/fileMentions.ts); the quoted and the backslash-escaped spellings are tried
    // too, to see which one Claude Code expands, each in a turn of its own with its own file.
    const spans: Record<string, [number, number]> = {};
    for (const { form, mention } of SPACE_FORMS) {
      const from = s.msgs.length;
      await s.turn(
        `What is the secret word in ${mention}? Do not use any tools. Reply with just the word, or NOFILE if you can't see the file.`,
      );
      spans[form] = [from, s.msgs.length];
    }
    cap.notes.spans = spans;
    await s.close();
  },
};

const goal: Scenario = {
  name: "goal",
  budget: 3,
  async run(ctx) {
    const { run, cap } = ctx;
    script(ctx, [
      {
        raw: {
          type: "assistant",
          message: {
            model: "<synthetic>",
            role: "assistant",
            content: [{ type: "text", text: "Goal set: reply with GOALDONE once" }],
          },
          parent_tool_use_id: null,
        },
      },
      { text: "GOALDONE" },
      {
        raw: {
          type: "user",
          message: { role: "user", content: "Stop hook feedback: not yet met" },
          isSynthetic: true,
          parent_tool_use_id: null,
        },
      },
      { text: "GOALDONE again" },
    ]);
    const s = ctx.open({});
    // A goal the first reply already meets: nothing here may keep itself going.
    const first = await s.turn(
      "/goal reply with the single word GOALDONE once, then you are done",
      { timeoutMs: 150_000 },
    );
    cap.notes.firstResult = first.result !== null;
    // Whether anything goes on by itself, for a moment; the budget bounds it either way.
    cap.notes.more =
      (await s.next(isResult, run.fake ? 3000 : 20_000, s.msgs.length)) !== null;
    await s.interrupt();
    await s.close();
  },
};

const loop: Scenario = {
  name: "loop",
  budget: 2,
  async run(ctx) {
    const { run, cap } = ctx;
    script(ctx, [{ text: "TICK" }]);
    // A turn nobody sent, as `/loop` causes once the first is over.
    run.fakeClaude?.spontaneous([{ text: "TICK" }]);
    const s = ctx.open({ policy: { allow: ["CronCreate", "CronList", "CronDelete"] } });
    const first = await s.turn("/loop 1m reply with only the word TICK", {
      timeoutMs: 150_000,
    });
    cap.notes.firstResult = first.result !== null;
    if (run.fake) {
      cap.notes.spontaneous = (await s.next(isResult, 10_000, s.msgs.length)) !== null;
    }
    // One iteration is all that is wanted: nothing is left running to spend a turn.
    await s.interrupt();
    await s.close();
  },
};

const tasks: Scenario = {
  name: "tasks",
  // Enough that the session is not stopped while a background task is still running: the
  // subagent's turn, the Bash turn, the interrupted count and what a task's end starts by itself.
  budget: 7,
  async run(ctx) {
    const { run, cap } = ctx;
    const s = ctx.open({
      policy: { subagent: SUBAGENT_TOOLS, bash: BASH_COMMAND },
      blocked: { bash: true },
      agents: {
        "kb-probe": {
          description: "Replies with one word. Use it when asked to use kb-probe.",
          prompt: "Reply with the single word: hi",
          tools: [],
          model: "haiku",
        },
      },
    });
    if (run.settings.bashCovered) {
      cap.notes.bashSkipped = true;
    }
    script(ctx, [
      {
        tool: {
          name: "Agent",
          input: { subagent_type: "kb-probe", description: "probe", prompt: "Reply hi" },
        },
        // As recorded from a real Claude Code (#161): the Agent tool launches asynchronously, the
        // task is backgrounded, and it ends before the turn's result.
        task: {
          id: "task-agent-1",
          description: "probe",
          subagentType: "kb-probe",
          background: true,
        },
        result: "Async agent launched",
        ask: true,
      },
      { taskEnd: { id: "task-agent-1" } },
      { text: "It said hi." },
    ]);
    cap.notes.foregroundFrom = s.msgs.length;
    await s.turn(
      "Use the Agent tool once with subagent_type kb-probe and the prompt 'Reply hi', then tell me in one word what it said.",
      { timeoutMs: 150_000 },
    );
    cap.notes.foregroundTo = s.msgs.length;
    // A finished task can start a turn nobody sent (it tells Claude): let that end first.
    await s.settled(30_000);
    if (!run.settings.bashCovered) {
      script(ctx, [
        {
          tool: {
            name: "Bash",
            input: { command: BASH_COMMAND, run_in_background: true },
          },
          task: {
            id: "task-bg-1",
            type: "bash",
            background: true,
            description: "sleep",
          },
          result: "Command running in the background",
          ask: true,
        },
        { text: "STARTED" },
      ]);
      cap.notes.backgroundFrom = s.msgs.length;
      await s.turn(
        `Call the Bash tool exactly once with the command \`${BASH_COMMAND}\` and run_in_background set to true. Then reply only STARTED.`,
        { timeoutMs: 150_000 },
      );
      const started = s.msgs
        .slice(cap.notes.backgroundFrom as number)
        .find((m) => isSystem(m, "task_started") && m.task_type !== "local_agent");
      cap.notes.backgroundId = started?.task_id;
      // Interrupt a running turn while the task runs: does the task survive (`perTaskStopAffordance`)?
      script(ctx, [{ text: ["1\n", "2\n", { hold: "count" }, "3\n"] }]);
      cap.notes.interruptFrom = s.msgs.length;
      const from = s.send("Count from 1 to 300, one number per line.");
      await s.next(
        (m) => m.type === "stream_event" || m.type === "assistant",
        60_000,
        from,
      );
      await s.interrupt();
      await s.next(isResult, 60_000, from);
      cap.notes.interruptTo = s.msgs.length;
      // Stop the task by its ID, as the Transcript's Stop does.
      if (s.stoppedForBudget) {
        cap.notes.stopSkipped = "its budget was spent first";
      } else if (typeof started?.task_id === "string") {
        cap.notes.stopFrom = s.msgs.length;
        try {
          await s.q.stopTask(started.task_id);
          cap.notes.stopAccepted = true;
        } catch (error) {
          cap.notes.stopAccepted = false;
          cap.notes.stopError = String(error).slice(0, 120);
        }
        await s.next(
          (m) => isSystem(m, "task_notification") && m.task_id === started.task_id,
          15_000,
          cap.notes.stopFrom as number,
        );
      }
    }
    await s.close();
  },
};

const midturn: Scenario = {
  name: "midturn",
  budget: 3,
  async run(ctx) {
    const { run, cap } = ctx;
    const first = randomUUID();
    const second = randomUUID();
    cap.notes.ids = { first, second };
    script(ctx, [
      {
        tool: {
          name: "Write",
          input: { file_path: join(run.folder, "m1.txt"), content: "1" },
        },
        hold: "gate",
        ask: true,
      },
      { text: "DONE" },
    ]);
    const s = ctx.open({});
    const from = s.send(
      `Use the Write tool to create five files named m1.txt to m5.txt in ${run.folder}, each containing its own number, one tool call per file, one after another. Then reply DONE.`,
      first,
    );
    const toolStarted = await s.next(
      (m) => toolCalls([m]).length > 0 || m.type === "result",
      90_000,
      from,
    );
    cap.notes.sentDuringTool = toolStarted !== null && toolStarted.type !== "result";
    s.send("After that, reply with only the word: second", second);
    run.fakeClaude?.release("gate");
    // Both turns end, whether the second was folded into the first or ran after it.
    // (A second prompt folded into the running turn gives one `result`, so the end of each
    // prompt is Claude Code's `command_lifecycle` `completed`, not a `result` apiece.)
    cap.notes.completed = await s.waitForCompleted([first, second], from, 150_000);
    cap.notes.from = from;
    await s.close();
  },
};

const compaction: Scenario = {
  name: "compaction",
  budget: 3,
  async run(ctx) {
    const { cap } = ctx;
    const s = ctx.open({});
    await s.turn("Reply with the single word: ok");
    script(ctx, [
      { system: { subtype: "status", status: "compacting" } },
      {
        system: {
          subtype: "compact_boundary",
          compact_metadata: { trigger: "manual", pre_tokens: 1000, post_tokens: 100 },
        },
      },
    ]);
    cap.notes.from = s.msgs.length;
    await s.turn("/compact", { timeoutMs: 150_000 });
    await s.close();
  },
};

/**
 * The rails seen working: a fake that asks for what must never be allowed. With the real
 * `claude` this is not played (it takes a model that calls forbidden tools); the same decisions
 * are tested in test/live-check-rails.test.ts.
 */
const rails: Scenario = {
  name: "rails",
  budget: 2,
  realCannot:
    "it needs a model that asks for forbidden tools; the decisions are unit-tested",
  async run(ctx) {
    const { run, cap } = ctx;
    const outside = join(run.tmp, "..", `kb-livecheck-${run.id}-outside.txt`);
    script(ctx, [
      { tool: { name: "mcp__example__send_message", input: { to: "x" } }, ask: true },
      {
        tool: { name: "Write", input: { file_path: outside, content: "x" } },
        ask: true,
      },
      {
        tool: {
          name: "Write",
          input: { file_path: join(run.folder, "inside.txt"), content: "x" },
        },
        ask: true,
      },
      {
        tool: { name: "Bash", input: { command: "echo not-the-fixed-command" } },
        ask: true,
      },
      { text: "done" },
    ]);
    const s = ctx.open({});
    await s.turn("probe the rails");
    cap.notes.asks = s.asks.map((ask) => ({
      tool: ask.toolName,
      decision: ask.decision,
    }));
    await s.close();
    if (ctx.extras.breakMode === "leftover") {
      // A process a check forgot to end, working in the throwaway folder: the run must find and kill it.
      const child = spawn("sleep", ["300"], {
        cwd: run.folder,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      cap.notes.leftoverPid = child.pid;
    }
  },
};

export const SCENARIO_LIST: Scenario[] = [
  baseline,
  plan,
  focus,
  advisor,
  terminalScenario,
  clear,
  atPath,
  goal,
  loop,
  tasks,
  midturn,
  compaction,
  rails,
];

export type { LiveSession, Msg };
