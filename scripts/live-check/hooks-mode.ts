// Issue #177 (research, never on main): what the owner's real `claude` sends, through the SDK,
// for hooks, the starting permission mode, denials, refusals and rate limits. Three scenarios
// and their checks, on the live check's rails: Haiku, the turn budget, the throwaway folder,
// the settings fingerprint, redaction. The check's own hooks live in the session's `settings`
// (flag tier, never the owner's files) and print text marked `KBLC`, which is how a recording
// tells their output from the owner's own hooks' (kept as shape only, see privacy.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOOK_MARK, redactText } from "./privacy.ts";
import { blockedTools, claudeEnvironment } from "./rails.ts";
import { footerOf, TRUST_QUESTION, trustKey } from "./screen.ts";
import { isResult, type LiveSession, type Msg, toolCalls } from "./session.ts";
import { logOf, webModules } from "./shipped.ts";
import { shellQuote, Tmux, until } from "./tmux.ts";
import type { Check, Ctx, EvalContext, Outcome, Scenario } from "./types.ts";

// ---- The check's own hooks -------------------------------------------------------------

export const BLOCK_PROMPT = `${HOOK_MARK}-BLOCK-ME reply with the single word pong`;

const json = (value: unknown) => `printf '%s' ${shellQuote(JSON.stringify(value))}`;

/** One command hook. */
const hook = (command: string) => ({ type: "command", command, timeout: 10 });

/** Hooks for PreToolUse, PostToolUse, UserPromptSubmit and Stop, each with a `systemMessage`, a non-blocking error or a blocking reason. */
export const TEST_HOOKS = {
  UserPromptSubmit: [
    {
      hooks: [
        hook(
          `if grep -q ${HOOK_MARK}-BLOCK-ME; then ${json({
            decision: "block",
            reason: `${HOOK_MARK} prompt blocked by a UserPromptSubmit hook`,
          })}; else ${json({
            systemMessage: `${HOOK_MARK} systemMessage from a UserPromptSubmit hook`,
          })}; fi`,
        ),
      ],
    },
  ],
  PreToolUse: [
    {
      matcher: "Read",
      hooks: [
        hook(
          json({ systemMessage: `${HOOK_MARK} systemMessage from a PreToolUse hook` }),
        ),
      ],
    },
    {
      matcher: "Glob",
      hooks: [
        hook(
          `echo '${HOOK_MARK} Glob blocked by a PreToolUse hook (exit 2)' >&2; exit 2`,
        ),
      ],
    },
    {
      matcher: "Grep",
      hooks: [
        hook(
          json({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `${HOOK_MARK} Grep denied by a PreToolUse hook (JSON)`,
            },
          }),
        ),
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "Read",
      hooks: [
        hook(`echo '${HOOK_MARK} PostToolUse hook failed (exit 1)' >&2; exit 1`),
        hook(`echo '${HOOK_MARK} plain stdout from a PostToolUse hook'`),
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        hook(json({ systemMessage: `${HOOK_MARK} systemMessage from a Stop hook` })),
      ],
    },
  ],
};

const script = (
  ctx: Ctx,
  steps: Parameters<NonNullable<Ctx["run"]["fakeClaude"]>["script"]>[0],
) => ctx.run.fakeClaude?.script(steps);

const READ_PROMPT =
  "Use the Read tool once to read note.txt in the working directory, then reply with its first word only.";
const SEARCH_PROMPT =
  "Use the Glob tool once with the pattern *.txt, then use the Grep tool once to search for hello. Whatever happens, do not retry; reply with one short sentence.";

export const hooksScenario: Scenario = {
  name: "hooks",
  budget: 5,
  async run(ctx) {
    const { run, cap } = ctx;
    const note = join(run.folder, "note.txt");
    writeFileSync(note, "hello from the note\n");
    const on = ctx.open({
      includeHookEvents: true,
      extraSettings: { hooks: TEST_HOOKS },
    });
    script(ctx, [
      { tool: { name: "Read", input: { file_path: note } }, ask: true },
      { text: "hello" },
    ]);
    cap.notes.readFrom = on.msgs.length;
    await on.turn(READ_PROMPT);
    cap.notes.searchFrom = on.msgs.length;
    script(ctx, [{ text: "Both searches were blocked." }]);
    await on.turn(SEARCH_PROMPT);
    cap.notes.blockFrom = on.msgs.length;
    script(ctx, [{ text: "pong" }]);
    await on.turn(BLOCK_PROMPT, { timeoutMs: 60_000 });
    await on.close();
    // The same hooks with the option off, as k-bench launches today.
    const off = ctx.open({ extraSettings: { hooks: TEST_HOOKS } });
    script(ctx, [
      { tool: { name: "Read", input: { file_path: note } }, ask: true },
      { text: "hello" },
    ]);
    await off.turn(READ_PROMPT);
    await off.close();
  },
};

// ---- Denials -----------------------------------------------------------------------------

export const DENY_RULE = "WebFetch(domain:example.com)";

export const denialsScenario: Scenario = {
  name: "denials",
  budget: 3,
  async run(ctx) {
    // A deny rule, in the default mode k-bench runs in. WebFetch is offered (not removed from
    // the context) so that the rule, not `disallowedTools`, refuses it; `canUseTool` denies it too.
    const rule = ctx.open({
      blocked: { webFetch: true },
      // The subagent tool too: the first real run's Haiku sent the fetch to a subagent.
      extraSettings: { permissions: { deny: [DENY_RULE, "Agent", "Task"] } },
    });
    script(ctx, [
      {
        tool: {
          name: "WebFetch",
          input: { url: "https://example.com", prompt: "title" },
        },
        ask: true,
      },
      { text: "REFUSED" },
    ]);
    await rule.turn(
      "Call the WebFetch tool yourself, once (no subagent), to fetch https://example.com and tell me its title. If the tool is refused, reply only REFUSED and try nothing else.",
    );
    await rule.close();
    // `dontAsk`: what is not pre-approved is refused without an ask.
    const dontAsk = ctx.open({ permissionMode: "dontAsk" });
    script(ctx, [
      {
        tool: {
          name: "Write",
          input: { file_path: join(ctx.run.folder, "dontask.txt"), content: "ok" },
        },
        ask: true,
      },
      { text: "REFUSED" },
    ]);
    await dontAsk.turn(
      "Use the Write tool once to create dontask.txt in the working directory containing the word ok. If the tool is refused, reply only REFUSED and try nothing else.",
    );
    await dontAsk.close();
  },
};

// ---- Starting mode -----------------------------------------------------------------------

const IDLE =
  /❯[\s\S]*(?:manual mode on|accept edits on|plan mode on|auto mode on|bypass permissions on|don't ask on|\? for shortcuts)/i;
const MODE_LABEL =
  /(manual mode on|accept edits on|plan mode on|auto mode on|auto-accept edits on|bypass permissions on|don't ask on|\? for shortcuts)/i;
const MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];

/** The owner's `permissions.defaultMode`, as a label (a known mode, `absent` or `other`). */
function defaultModeLabel(configDir: string, file: string): string {
  try {
    const settings = JSON.parse(readFileSync(join(configDir, file), "utf8")) as {
      permissions?: { defaultMode?: unknown };
    };
    const mode = settings.permissions?.defaultMode;
    if (mode === undefined) return "absent";
    return typeof mode === "string" && MODES.includes(mode) ? mode : "other";
  } catch {
    return "no file";
  }
}

export const startModeScenario: Scenario = {
  name: "start-mode",
  // The mode is read from Claude Code's first reply and from the TUI's footer; one plain turn
  // (no tool), only when the first reply says `default`, reads it again from the turn's `init`.
  budget: 1,
  async run(ctx) {
    const { run, cap } = ctx;
    cap.notes.defaultMode = {
      "settings.json": defaultModeLabel(run.configDir, "settings.json"),
      "settings.local.json": defaultModeLabel(run.configDir, "settings.local.json"),
    };
    // Without `canUseTool` (and no `permissionMode`): never sent a prompt, only asked its mode.
    const probe = ctx.open({ permissionMode: null, probeOnly: true });
    const probeReply = (await probe.q.initializationResult()) as unknown as Record<
      string,
      unknown
    >;
    cap.notes.sdkModeNoCanUseTool = probeReply.current_permission_mode ?? "absent";
    await probe.close();
    // No `permissionMode`, as k-bench's runtime launches; hook events on, to count what the
    // owner's own hooks would draw on a plain turn (the `owner-hook-lines` check).
    const s = ctx.open({ permissionMode: null, includeHookEvents: true });
    const reply = (await s.q.initializationResult()) as unknown as Record<
      string,
      unknown
    >;
    cap.notes.sdkMode = reply.current_permission_mode ?? "absent";
    if (cap.notes.sdkMode === "default") {
      script(ctx, [{ text: "pong" }]);
      await s.turn("Reply with the single word: pong");
      cap.notes.initMode = s.init?.permissionMode ?? "absent";
    } else {
      cap.notes.initMode = "no turn sent (the first reply did not say default)";
    }
    const models = Array.isArray(reply.models) ? (reply.models as Msg[]) : [];
    cap.notes.autoSupport = models.map(
      (m) =>
        `${String(m.value)}: supportsAutoMode ${m.supportsAutoMode === undefined ? "absent" : String(m.supportsAutoMode)}`,
    );
    await s.close();
    if (run.fake) {
      cap.notes.tui = "not run in --fake";
      return;
    }
    // The TUI on the same folder and settings, with no `--permission-mode`: its footer names the mode.
    const tmux = new Tmux(
      run.id,
      claudeEnvironment(process.env, { advisorOff: true }),
      run.abort.signal,
    );
    ctx.extras.tmux = tmux;
    try {
      const command = [
        shellQuote(run.claude),
        "--model",
        "haiku",
        "--effort",
        "low",
        "--strict-mcp-config",
        "--settings",
        shellQuote(JSON.stringify({ disableClaudeAiConnectors: true })),
        "--disallowedTools",
        shellQuote(blockedTools({ fromRules: run.settings.denyToo }).join(",")),
      ].join(" ");
      const pid = tmux.start(command, run.folder);
      if (pid !== undefined) run.pids.add(pid);
      let label = "not reached";
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && tmux.alive() && !run.abort.signal.aborted) {
        const pane = tmux.capture();
        if (IDLE.test(pane) && !TRUST_QUESTION.test(pane)) {
          label = MODE_LABEL.exec(footerOf(pane))?.[1] ?? "no mode label in the footer";
          break;
        }
        const key = trustKey(pane);
        if (key !== "none") tmux.keys(key);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      cap.notes.tui = label;
      if (tmux.alive()) {
        tmux.type("/exit");
        tmux.keys("Enter");
        await until(() => !tmux.alive(), 15_000);
      }
    } finally {
      tmux.kill();
    }
  },
};

// ---- Judging -------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const carrier = (m: Msg) =>
  `${String(m.type)}${typeof m.subtype === "string" ? `/${m.subtype}` : ""}${m.is_meta === true ? " (is_meta)" : ""}${m.isMeta === true ? " (isMeta)" : ""}`;

const has = (value: unknown, text: string) => JSON.stringify(value ?? "").includes(text);

/** Which kinds of message carry `text`, with a count. */
function carriersOf(msgs: readonly Msg[], text: string): string[] {
  const counts = new Map<string, number>();
  for (const m of msgs) {
    if (m.type === "stream_event") continue;
    if (has(m, text)) counts.set(carrier(m), (counts.get(carrier(m)) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${label} x${n}`);
}

/** Which items k-bench's `buildItems` draws that hold `text`, and their kinds. */
async function drawnAs(session: LiveSession, text: string): Promise<string[]> {
  const { items } = await webModules();
  return items
    .buildItems(logOf(session.events))
    .items.filter((item) => has(item, text))
    .map((item) =>
      item.kind === "tool"
        ? `tool ${String(item.name)} (${String(item.status)})`
        : item.kind === "hook"
          ? `hook ${String(item.name)} (${String(item.outcome)})`
          : String(item.kind),
    );
}

/** `hook_*` lifecycle messages: `subtype event [outcome exit]`, marked when they are the check's own. */
function hookMessages(msgs: readonly Msg[]): string[] {
  return msgs
    .filter((m) => m.type === "system" && /^hook_/.test(String(m.subtype)))
    .map(
      (m) =>
        `${String(m.subtype)} ${String(m.hook_name ?? m.hook_event)}${m.outcome ? ` ${String(m.outcome)}` : ""}${m.exit_code !== undefined ? ` exit ${String(m.exit_code)}` : ""}${has(m, HOOK_MARK) ? " [ours]" : ""}`,
    );
}

const STRINGS = {
  upsNote: `${HOOK_MARK} systemMessage from a UserPromptSubmit hook`,
  preNote: `${HOOK_MARK} systemMessage from a PreToolUse hook`,
  stopNote: `${HOOK_MARK} systemMessage from a Stop hook`,
  postError: `${HOOK_MARK} PostToolUse hook failed`,
  postStdout: `${HOOK_MARK} plain stdout from a PostToolUse hook`,
  globBlock: `${HOOK_MARK} Glob blocked`,
  grepDeny: `${HOOK_MARK} Grep denied`,
  promptBlock: `${HOOK_MARK} prompt blocked`,
};

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

const FAKE_HOOKS = "the fake runs no hooks";

const hookEvents: Check = {
  name: "hook-events",
  row: "A3",
  title:
    "#177 Q1: which hook_* messages arrive for PreToolUse, PostToolUse, UserPromptSubmit and Stop, with includeHookEvents on and off",
  scenario: "hooks",
  fakeCannot: FAKE_HOOKS,
  assumption:
    "src/agent-runtime/session.ts ClaudeSession (includeHookEvents unset) with web/src/agent/uncommon.ts readSystem (the hook line reads hook_response)",
  async evaluate({ cap }) {
    const [on, off] = cap.sessions;
    if (!on || !off) return notProvoked("a session of the scenario did not run");
    // What the hook line would show with the option on: the check's own hooks and the owner's.
    const { items } = await webModules();
    const drawn = (s: LiveSession) =>
      items.buildItems(logOf(s.events)).items.filter((item) => item.kind === "hook");
    const hookItems = drawn(on);
    const ownerItems = hookItems.filter((item) => !has(item, HOOK_MARK));
    const onHooks = hookMessages(on.msgs);
    const offHooks = hookMessages(off.msgs);
    const events = (list: string[]) =>
      ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"].filter((event) =>
        list.some(
          (line) =>
            line.startsWith("hook_response") &&
            line.includes(event) &&
            line.endsWith("[ours]"),
        ),
      );
    const onEvents = events(onHooks);
    const offEvents = events(offHooks);
    const facts = [
      `option on: ${onHooks.length} hook_* messages: ${onHooks.join("; ") || "none"}`,
      `option off: ${offHooks.length} hook_* messages: ${offHooks.join("; ") || "none"}`,
      `our hook_response events, on: ${onEvents.join(", ") || "none"}; off: ${offEvents.join(", ") || "none"}`,
      `hook lines k-bench draws with the option on: ${hookItems.length} (the owner's own hooks: ${ownerItems.length}, as ${ownerItems.map((item) => `${String(item.name)} ${String(item.outcome)}`).join("; ") || "none"}); with it off: ${drawn(off).length}`,
    ];
    if (onEvents.length === 0)
      return notProvoked(
        "no hook_response from the check's hooks arrived even with the option on",
        facts,
      );
    return offEvents.length < onEvents.length
      ? fail(
          "with includeHookEvents unset (as k-bench launches) these hooks' hook_response never arrives, so the hook line in uncommon.ts never fires for them",
          facts,
        )
      : pass("the hook responses arrive with the option off as well", facts);
  },
};

const hookSystemMessage: Check = {
  name: "hook-system-message",
  row: "A3",
  title:
    "#177 Q1: where a hook's systemMessage arrives, and whether k-bench draws it as Claude's words",
  scenario: "hooks",
  fakeCannot: FAKE_HOOKS,
  assumption:
    "web/src/agent/items.ts buildItems, assistant case (no is_meta check), and web/src/agent/uncommon.ts hookLines (systemMessage read from a hook's JSON stdout)",
  async evaluate({ cap }) {
    const [on, off] = cap.sessions;
    if (!on || !off) return notProvoked("a session of the scenario did not run");
    const facts: string[] = [];
    let asClaude = false;
    let seen = false;
    for (const [label, s] of [
      ["on", on],
      ["off", off],
    ] as const) {
      for (const [name, text] of [
        ["UserPromptSubmit", STRINGS.upsNote],
        ["PreToolUse", STRINGS.preNote],
        ["Stop", STRINGS.stopNote],
      ] as const) {
        const carriers = carriersOf(s.msgs, text);
        const drawn = await drawnAs(s, text);
        if (carriers.length > 0) seen = true;
        if (drawn.includes("assistant")) asClaude = true;
        facts.push(
          `option ${label}, ${name} systemMessage: arrives in ${carriers.join(", ") || "nothing"}; drawn as ${drawn.join(", ") || "nothing"}`,
        );
      }
    }
    if (!seen) return notProvoked("no systemMessage of the check's hooks arrived", facts);
    return asClaude
      ? fail(
          "a hook's systemMessage is drawn as an assistant item, as if Claude had said it",
          facts,
        )
      : pass("no hook systemMessage is drawn as Claude's words", facts);
  },
};

const hookBlocks: Check = {
  name: "hook-blocks",
  row: "A3",
  title:
    "#177 Q1: how a hook's non-blocking error and a blocking reason arrive, and what k-bench draws",
  scenario: "hooks",
  fakeCannot: FAKE_HOOKS,
  assumption:
    "web/src/agent/uncommon.ts readSystem (hook_response outcome) and web/src/agent/items.ts resolveTool (a blocked tool's result)",
  async evaluate({ cap }) {
    const [on, off] = cap.sessions;
    if (!on || !off) return notProvoked("a session of the scenario did not run");
    const facts: string[] = [];
    const lost: string[] = [];
    let arrived = false;
    for (const [label, s] of [
      ["on", on],
      ["off", off],
    ] as const) {
      for (const [name, text] of [
        ["PostToolUse exit 1 (non-blocking error)", STRINGS.postError],
        ["PostToolUse plain stdout", STRINGS.postStdout],
        ["PreToolUse exit 2 on Glob (blocking)", STRINGS.globBlock],
        ["PreToolUse JSON deny on Grep (blocking)", STRINGS.grepDeny],
        ["UserPromptSubmit decision block", STRINGS.promptBlock],
      ] as const) {
        const carriers = carriersOf(s.msgs, text);
        if (carriers.length === 0 && label === "off" && !name.startsWith("PostToolUse"))
          continue;
        const drawn = await drawnAs(s, text);
        if (carriers.length > 0) arrived = true;
        if (carriers.length > 0 && drawn.length === 0)
          lost.push(`${name} (option ${label})`);
        facts.push(
          `option ${label}, ${name}: arrives in ${carriers.join(", ") || "nothing"}; drawn as ${drawn.join(", ") || "nothing"}`,
        );
      }
    }
    const calls = toolCalls(on.msgs).map((call) => call.name);
    facts.push(`tools Claude called (option on): ${calls.join(", ") || "none"}`);
    const blockResults = on.msgs.slice(Number(cap.notes.blockFrom ?? 0)).filter(isResult);
    facts.push(
      `the blocked prompt: ${blockResults.length} result(s)${blockResults[0] ? ` (subtype ${String(blockResults[0].subtype)}, is_error ${String(blockResults[0].is_error)}, num_turns ${String(blockResults[0].num_turns)})` : ""}`,
    );
    if (!arrived) return notProvoked("none of the hooks' reasons arrived", facts);
    return lost.length > 0
      ? fail(
          `these arrive but k-bench draws nothing that holds their text: ${lost.join("; ")}`,
          facts,
        )
      : pass("every hook error and block reason that arrives is drawn somewhere", facts);
  },
};

const startMode: Check = {
  name: "start-mode",
  row: "A3",
  title: "#177 Q2: the mode an Agent starts in with no permissionMode, against the TUI's",
  scenario: "start-mode",
  assumption:
    "src/agent-runtime/session.ts ClaudeSession (permissionMode unset) and ClaudeSession.permissionMode (current_permission_mode)",
  evaluate({ cap, run }) {
    const tuiLabel = String(cap.notes.tui ?? "not reached");
    const tuiMode =
      {
        "manual mode on": "default",
        "? for shortcuts": "default",
        "accept edits on": "acceptEdits",
        "auto-accept edits on": "acceptEdits",
        "plan mode on": "plan",
        "auto mode on": "auto",
        "bypass permissions on": "bypassPermissions",
        "don't ask on": "dontAsk",
      }[tuiLabel.toLowerCase()] ?? undefined;
    const sdk = String(cap.notes.sdkMode);
    const facts = [
      `owner's permissions.defaultMode: ${JSON.stringify(cap.notes.defaultMode)}`,
      `SDK, no permissionMode, model haiku, canUseTool set (as k-bench): current_permission_mode ${sdk}; the first turn's init.permissionMode ${String(cap.notes.initMode)}`,
      `SDK, no permissionMode, model haiku, no canUseTool: current_permission_mode ${String(cap.notes.sdkModeNoCanUseTool)}`,
      `TUI, no --permission-mode, model haiku: footer "${tuiLabel}"${tuiMode ? ` (${tuiMode})` : ""}`,
      `models: ${((cap.notes.autoSupport as string[] | undefined) ?? []).join("; ")}`,
    ];
    if (run.fake) return { verdict: "PASS", reason: "fake: the SDK side ran", facts };
    if (!tuiMode) return notProvoked("the TUI's footer was not read", facts);
    return sdk === tuiMode
      ? pass("the Agent starts in the same mode as the terminal", facts)
      : fail(
          "the Agent starts in another mode than the terminal for the same settings",
          facts,
        );
  },
};

/** The text of a tool result block. */
const resultText = (block: Msg): string =>
  typeof block.content === "string"
    ? block.content
    : Array.isArray(block.content)
      ? (block.content as Msg[]).map((b) => String(b.text ?? "")).join("\n")
      : "";

const denialShape: Check = {
  name: "denial-shape",
  row: "A3",
  title:
    "#177 Q3: what permission_denied carries for a deny rule and for dontAsk, and the tool result beside it",
  scenario: "denials",
  fakeCannot: "the fake sends no permission_denied",
  assumption:
    "web/src/agent/uncommon.ts readSystem (permission_denied falls through, nothing drawn) and web/src/agent/items.ts resolveTool (a refused tool is `failed` with its text, or `Denied`)",
  async evaluate({ cap, run }) {
    const facts: string[] = [];
    let denials = 0;
    let reasonLost = false;
    for (const [label, s] of cap.sessions.map(
      (s, i) => [i === 0 ? "deny rule" : "dontAsk", s] as const,
    )) {
      const calls = toolCalls(s.msgs);
      facts.push(
        `${label}: tools called ${calls.map((c) => c.name).join(", ") || "none"}; canUseTool asked ${s.asks.length} time(s)`,
      );
      for (const m of s.msgs.filter(
        (m) => m.type === "system" && m.subtype === "permission_denied",
      )) {
        denials += 1;
        const toolResult = s.msgs
          .filter((u) => u.type === "user" && isObject(u.message))
          .flatMap((u) => ((u.message as Msg).content as Msg[] | undefined) ?? [])
          .find(
            (b) =>
              isObject(b) && b.type === "tool_result" && b.tool_use_id === m.tool_use_id,
          );
        const same = toolResult ? resultText(toolResult) === m.message : false;
        facts.push(
          `${label}: permission_denied keys [${Object.keys(m).sort().join(", ")}]; tool_name ${String(m.tool_name)}; decision_reason_type ${String(m.decision_reason_type)}; decision_reason ${m.decision_reason === undefined ? "absent" : `"${redactText(String(m.decision_reason), run.places).slice(0, 160)}"`}; message "${redactText(String(m.message), run.places).slice(0, 200)}"`,
        );
        facts.push(
          `${label}: tool_result beside it: ${toolResult ? `is_error ${String(toolResult.is_error)}, text ${same ? "identical to message" : `"${redactText(resultText(toolResult), run.places).slice(0, 200)}"`}` : "none found"}`,
        );
        const drawn = await drawnAs(s, String(m.message).slice(0, 40));
        facts.push(
          `${label}: k-bench draws the message as ${drawn.join(", ") || "nothing"}`,
        );
        if (drawn.length === 0) reasonLost = true;
      }
      for (const r of s.msgs.filter(isResult)) {
        const list = Array.isArray(r.permission_denials)
          ? (r.permission_denials as Msg[])
          : [];
        facts.push(
          `${label}: result.permission_denials ${list.length}${list[0] ? ` (keys ${Object.keys(list[0]).sort().join(", ")})` : ""}; terminal_reason ${String(r.terminal_reason ?? "absent")}`,
        );
      }
      const items = await (async () => {
        const { items: web } = await webModules();
        return web.buildItems(logOf(s.events)).items.filter((i) => i.kind === "tool");
      })();
      facts.push(
        `${label}: tool items ${items.map((i) => `${String(i.name)} ${String(i.status)} (${isObject(i.result) && i.result.summary ? String(i.result.summary) : "lines"})`).join(", ") || "none"}`,
      );
    }
    if (denials === 0) return notProvoked("no permission_denied arrived", facts);
    return reasonLost
      ? fail("a denial's reason arrives but k-bench draws it nowhere", facts)
      : pass("each denial's message is drawn (as the tool's result)", facts);
  },
};

const refusals: Check = {
  name: "refusals",
  row: "A3",
  title: "#177 Q4: model_refusal_fallback / model_refusal_no_fallback shapes",
  scenario: "hooks",
  fakeCannot: FAKE_HOOKS,
  assumption:
    "web/src/agent/unsupported.ts (recognised) and web/src/agent/uncommon.ts readSystem (no reader)",
  evaluate({ all }) {
    const msgs = [...all.values()].flatMap((cap) => cap.sessions.flatMap((s) => s.msgs));
    const found = msgs.filter(
      (m) => m.type === "system" && /^model_refusal/.test(String(m.subtype)),
    );
    if (found.length === 0) {
      return notProvoked(
        "not provoked on purpose: a refusal needs a prompt the model refuses (a safety category), which the check does not send",
      );
    }
    return pass(
      "a refusal arrived",
      found.map((m) => `${String(m.subtype)} keys [${Object.keys(m).sort().join(", ")}]`),
    );
  },
};

/** A number as a range of tenths: `0.2-0.3`. */
const tenth = (value: number) => {
  const low = Math.floor(value * 10) / 10;
  return `${low.toFixed(1)}-${(low + 0.1).toFixed(1)}`;
};

const rateLimit: Check = {
  name: "rate-limit",
  row: "A3",
  title:
    "#177 Q5: the rate_limit_event of a normal turn: fields, utilization range, overage fields",
  scenario: "start-mode",
  fakeCannot: "the fake's rate_limit_event is a fixture",
  assumption:
    "web/src/agent/uncommon.ts readRateLimit (only allowed_warning and rejected are a line)",
  evaluate({ all }) {
    const events = [...all.values()]
      .flatMap((cap) => cap.sessions.flatMap((s) => s.msgs))
      .filter((m) => m.type === "rate_limit_event");
    if (events.length === 0) return notProvoked("no rate_limit_event arrived");
    // Labels and ranges only: a fraction as tenths, a time as how far off, nested objects by their keys.
    const labelsOf = (info: Record<string, unknown>, depth: number): string =>
      Object.keys(info)
        .sort()
        .map((key) => {
          const value = info[key];
          if (typeof value === "number" && /resets?At$/i.test(key)) {
            const hours =
              ((value > 1e12 ? value : value * 1000) - Date.now()) / 3_600_000;
            return `${key} in ${hours < 0 ? "the past" : hours < 6 ? "under 6h" : hours < 48 ? "6-48h" : hours < 24 * 8 ? "2-8 days" : "over 8 days"}`;
          }
          if (typeof value === "number")
            return value >= 0 && value <= 1
              ? `${key} ${tenth(value)}`
              : `${key} (a number ${value > 1 && value <= 100 ? "1-100" : "outside 0-100"})`;
          if (typeof value === "string" || typeof value === "boolean")
            return `${key} ${String(value)}`;
          if (value === null) return `${key} null`;
          if (isObject(value) && depth < 3)
            return `${key} {${labelsOf(value, depth + 1)}}`;
          if (Array.isArray(value)) return `${key} (a list of ${value.length})`;
          return `${key} (${typeof value})`;
        })
        .join(", ");
    const facts = events.map((m, i) => {
      const info = isObject(m.rate_limit_info) ? m.rate_limit_info : {};
      return `event ${i + 1}: ${labelsOf(info, 0)}`;
    });
    const statuses = new Set(
      events.map((m) =>
        isObject(m.rate_limit_info) ? m.rate_limit_info.status : undefined,
      ),
    );
    return pass(`${events.length} event(s), status ${[...statuses].join(", ")}`, facts);
  },
};

const ownerHookLines: Check = {
  name: "owner-hook-lines",
  row: "A3",
  title:
    "#177 Q1: what the owner's own hooks would draw on one plain turn with includeHookEvents on",
  scenario: "start-mode",
  fakeCannot: FAKE_HOOKS,
  assumption:
    "web/src/agent/uncommon.ts readSystem hook_response (a hook that printed anything is a line, whatever its outcome)",
  async evaluate({ cap }) {
    const s = cap.sessions[1];
    if (!s || s.msgs.filter(isResult).length === 0)
      return notProvoked("the plain turn was not sent");
    const { items } = await webModules();
    const built = items.buildItems(logOf(s.events)).items;
    const hooks = built.filter((item) => item.kind === "hook");
    const responses = s.msgs.filter(
      (m) => m.type === "system" && m.subtype === "hook_response",
    );
    const printed = responses.filter(
      (m) => String(m.stdout ?? "") !== "" || String(m.stderr ?? "") !== "",
    );
    const facts = [
      `hook_response messages: ${responses.length} (${responses.map((m) => `${String(m.hook_name)} ${String(m.outcome)}`).join("; ") || "none"})`,
      `of them printed something: ${printed.length}; stdout that is JSON: ${
        printed.filter((m) =>
          String(m.stdout ?? "")
            .trim()
            .startsWith("{"),
        ).length
      }`,
      `hook lines drawn: ${hooks.length} (${hooks.map((item) => `${String(item.name)} ${String(item.outcome)}, ${Array.isArray(item.lines) ? item.lines.length : 0} line(s)`).join("; ") || "none"})`,
      `notices drawn: ${built.filter((item) => item.kind === "notice").length}`,
    ];
    return hooks.some((item) => item.outcome === "success")
      ? fail(
          "with the option on, the owner's successful hooks draw a line on every plain turn (what the terminal shows for them was not checked here)",
          facts,
        )
      : pass("the owner's hooks draw no line for a successful run", facts);
  },
};

export const HOOKS_MODE_CHECKS: Check[] = [
  ownerHookLines,
  hookEvents,
  hookSystemMessage,
  hookBlocks,
  startMode,
  denialShape,
  refusals,
  rateLimit,
];

export type { EvalContext };
