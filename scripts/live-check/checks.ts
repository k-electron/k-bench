// Judging what the scenarios saw: one check per line of issue #161's A2 and A3. Each runs the
// recorded messages through k-bench's own code (the browser's `buildItems`, `Activity`,
// `TaskTracker`, `ConversationTracker`, `planTerminalImport`, `CommandList`,
// `subscriptionProblem`) and says which assumption in that code the answer confirms or refutes.
// What a verdict says is a label, a count or a short fact, never account details or paths,
// because it goes in results.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DENIED_WITH_REPLY } from "../../src/agent-runtime/asks.ts";
import { autoModeSupported } from "../../src/agent-runtime/mode.ts";
import { permissionModeCycle } from "../../src/shared/agent-protocol.ts";
import { HOOKS_MODE_CHECKS } from "./hooks-mode.ts";
import { SPACE_FORMS } from "./scenarios.ts";
import {
  assistantText,
  blocks,
  isInit,
  isResult,
  isSystem,
  type LiveSession,
  type Msg,
  toolCalls,
} from "./session.ts";
import {
  activityStates,
  CommandList,
  ConversationTracker,
  type Item,
  logOf,
  planTerminalImport,
  type SavedMessage,
  subscriptionProblem,
  TaskTracker,
  webModules,
} from "./shipped.ts";
import { DENY_FEEDBACK } from "./terminal.ts";
import type { Check, EvalContext, Outcome } from "./types.ts";

// ---- Small helpers ---------------------------------------------------------------------

const pass = (reason: string, facts?: string[]): Outcome => ({
  verdict: "PASS",
  reason,
  ...(facts ? { facts } : {}),
});
const fail = (reason: string, facts?: string[]): Outcome => ({
  verdict: "FAIL",
  reason,
  ...(facts ? { facts } : {}),
});
const notProvoked = (reason: string, facts?: string[]): Outcome => ({
  verdict: "NOT PROVOKED",
  reason,
  ...(facts ? { facts } : {}),
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const yesNo = (value: boolean) => (value ? "yes" : "no");

function noteOf<T>(cap: EvalContext["cap"], key: string): T | undefined {
  return cap.notes[key] as T | undefined;
}

const sessionOf = (cap: EvalContext["cap"], index = 0): LiveSession | undefined =>
  cap.sessions[index];

/** The messages of a session from index `from` (or all). */
const slice = (session: LiveSession | undefined, from?: number, to?: number): Msg[] =>
  session ? session.msgs.slice(from ?? 0, to) : [];

const textOfContent = (m: Msg): string => {
  const inner = isObject(m.message) ? m.message : {};
  const content = inner.content;
  if (typeof content === "string") return content;
  return blocks(m)
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("\n");
};

/** The label of a message's carrier: `system/subtype`, `assistant`, ... */
const carrier = (m: Msg) =>
  `${m.type}${typeof m.subtype === "string" ? `/${m.subtype}` : ""}`;

/** The items the browser builds from a session's log. */
async function itemsOf(session: LiveSession): Promise<Item[]> {
  const { items } = await webModules();
  return items.buildItems(logOf(session.events)).items;
}

// ---- A2 --------------------------------------------------------------------------------

/** The plugins the owner has installed for themselves and enabled: names only. */
function installedUserPlugins(configDir: string): string[] {
  const read = (file: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(configDir, file), "utf8"));
    } catch {
      return undefined;
    }
  };
  const installed = read(join("plugins", "installed_plugins.json"));
  const settings = read("settings.json");
  const enabled =
    isObject(settings) && isObject(settings.enabledPlugins)
      ? settings.enabledPlugins
      : {};
  const table =
    isObject(installed) && isObject(installed.plugins) ? installed.plugins : {};
  const names: string[] = [];
  for (const [key, entries] of Object.entries(table)) {
    if (enabled[key] === false) continue;
    const scopes = Array.isArray(entries)
      ? entries.filter(isObject).map((entry) => entry.scope)
      : [];
    if (scopes.length > 0 && !scopes.includes("user")) continue;
    names.push(key.split("@")[0] ?? key);
  }
  return names;
}

const plugins: Check = {
  name: "plugins",
  row: "A2",
  title: "The owner's user-installed plugins appear in `plugins` on the first init",
  scenario: "baseline",
  assumption:
    "src/agent-runtime/session.ts ClaudeSession: the default settings sources load the owner's plugins, as in a terminal",
  evaluate({ run, cap }) {
    const init = noteOf<Msg>(cap, "firstInit");
    if (!init) return notProvoked("no init was seen");
    const expected = installedUserPlugins(run.configDir);
    const reported = Array.isArray(init.plugins)
      ? init.plugins.map((p) =>
          isObject(p) && typeof p.name === "string" ? p.name : String(p),
        )
      : [];
    const facts = [
      `user plugins installed and enabled: ${expected.length}`,
      `plugins in the first init: ${reported.length}`,
    ];
    if (expected.length === 0) {
      return notProvoked("the owner has no user-installed plugin to look for", facts);
    }
    const missing = expected.filter((name) => !reported.includes(name));
    return missing.length === 0
      ? pass("every installed user plugin is in the first init's plugins", facts)
      : fail(
          `${missing.length} installed plugin(s) are missing from the first init's plugins: the Agent would not load them`,
          facts,
        );
  },
};

const subscription: Check = {
  name: "subscription",
  row: "A2",
  title: "accountInfo() passes subscriptionProblem()",
  scenario: "baseline",
  assumption: "src/agent-runtime/account.ts subscriptionProblem",
  evaluate({ cap }) {
    const account = noteOf<Record<string, unknown>>(cap, "account");
    if (!account) return notProvoked("accountInfo() gave nothing");
    const key = account.apiKeySource;
    const facts = [
      `provider: ${typeof account.apiProvider === "string" ? account.apiProvider : "absent"}`,
      `key source: ${
        key === undefined
          ? "absent"
          : key === "none" || key === "oauth"
            ? String(key)
            : "an API key"
      }`,
      `subscription type present: ${yesNo(Boolean(account.subscriptionType))}`,
    ];
    const problem = subscriptionProblem(account as never);
    return problem === undefined
      ? pass("the login is accepted as a Claude subscription", facts)
      : fail("the runtime would refuse to start Agents on this login", facts);
  },
};

const planApproval: Check = {
  name: "plan-approval",
  row: "A2",
  title: "Approving ExitPlanMode in plan mode reaches canUseTool",
  scenario: "plan",
  assumption:
    "src/agent-runtime/asks.ts PermissionAsks; src/agent-runtime/mode.ts PermissionModeTracker",
  evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the plan session did not run");
    const asked = session.asks.filter((ask) => ask.toolName === "ExitPlanMode");
    const called = toolCalls(session.msgs).some((call) => call.name === "ExitPlanMode");
    if (asked.length === 0) {
      return called
        ? fail(
            "ExitPlanMode ran without reaching canUseTool: the plan card could not be answered",
          )
        : notProvoked("the model never called ExitPlanMode");
    }
    const modes = session.msgs
      .filter((m) => isSystem(m, "status") && typeof m.permissionMode === "string")
      .map((m) => String(m.permissionMode));
    const afterApproval = session.msgs
      .filter(isInit)
      .map((m) => String(m.permissionMode));
    return pass("the ExitPlanMode approval reached canUseTool", [
      `the CLI reported the new permission mode itself in a status message: ${yesNo(modes.length > 0)}${modes.length > 0 ? ` (${[...new Set(modes)].join(", ")})` : ""}`,
      `permissionMode in init: ${[...new Set(afterApproval)].join(", ") || "none"}`,
      "(src/agent-runtime/mode.ts sets the mode itself when the CLI does not say)",
    ]);
  },
};

const focusView: Check = {
  name: "focus-view",
  row: "A2",
  title: 'settings: { viewMode: "focus" } makes init.view_mode read focus',
  scenario: "focus",
  assumption:
    "src/agent-runtime/session.ts sdkLaunchOptions (focusView); web/src/agent/items.ts focusView",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    const init = session?.init;
    if (!session || !init) return notProvoked("no init was seen");
    const { items } = await webModules();
    const built = items.buildItems(logOf(session.events));
    const facts = [
      `init.view_mode: ${String(init.view_mode)}`,
      `Transcript focusView: ${built.focusView}`,
    ];
    return init.view_mode === "focus" && built.focusView
      ? pass("init.view_mode reads focus and the Transcript follows it", facts)
      : fail(
          "viewMode focus did not reach init.view_mode: Focus view would not apply",
          facts,
        );
  },
};

const advisor: Check = {
  name: "advisor",
  row: "A2",
  title:
    "--advisor is per-session, CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 turns it off, settings untouched",
  scenario: "advisor",
  fakeCannot: "the fake has no advisor tool",
  assumption: "src/agent-runtime/session.ts sdkLaunchOptions (advisor)",
  evaluate({ run, cap }) {
    const on = sessionOf(cap, 0);
    const off = sessionOf(cap, 1);
    if (!on?.init || !off?.init) return notProvoked("a session did not start");
    const tools = (m: Msg) =>
      Array.isArray(m.tools)
        ? (m.tools as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
    const onTools = tools(on.init).filter((t) => /advis/i.test(t));
    const offTools = tools(off.init).filter((t) => /advis/i.test(t));
    const answer = (s: LiveSession) => /^\s*yes/i.test(assistantText(s.msgs));
    const onYes = answer(on) || onTools.length > 0;
    const offYes = answer(off) || offTools.length > 0;
    // Only a change that happened while this scenario ran can be its doing: another running
    // Claude Code may rewrite a settings file at any time (that is a run-level FAIL line).
    const mine = run.settingsChanges.filter((change) => change.scenario === "advisor");
    const elsewhere = run.settingsChanges.filter(
      (change) => change.scenario !== "advisor",
    );
    const unchanged = mine.length === 0;
    const facts = [
      `advisor on: tool listed ${yesNo(onTools.length > 0)}, model says it has it ${yesNo(answer(on))}`,
      `advisor with the off switch: tool listed ${yesNo(offTools.length > 0)}, model says it has it ${yesNo(answer(off))}`,
      `settings files unchanged during this scenario: ${yesNo(unchanged)}${
        unchanged ? "" : ` (keys: ${mine.flatMap((change) => change.paths).join(", ")})`
      }`,
      ...(elsewhere.length > 0
        ? [
            `a settings file changed in another scenario (${elsewhere.map((c) => c.scenario).join(", ")}): see the run-level FAIL line`,
          ]
        : []),
    ];
    if (!unchanged)
      return fail("a settings file changed: --advisor must be per-session only", facts);
    if (!onYes) return fail("--advisor did not make the advisor tool available", facts);
    if (offYes)
      return fail(
        "CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 did not turn the advisor off",
        facts,
      );
    return pass(
      "--advisor adds the tool for the session, the environment switch removes it",
      facts,
    );
  },
};

const openInTerminal: Check = {
  name: "open-in-terminal",
  row: "A2",
  title: "One conversation moves SDK session, claude --resume, SDK session",
  scenario: "terminal",
  assumption:
    "ADR-0008; src/agent-runtime/main.ts importTerminalTurns (the conversation carries on by --resume)",
  evaluate({ run, cap }) {
    const sid = noteOf<string>(cap, "sid");
    const visit = noteOf<{
      reached: Record<string, boolean>;
      details: Record<string, string>;
    }>(cap, "visitOne");
    if (!sid) return notProvoked("the first web turns did not complete");
    if (!visit?.reached.up) {
      return notProvoked(
        `the terminal did not come up${noteOf<string>(cap, "visitOneError") ? ` (${noteOf<string>(cap, "visitOneError")})` : ""}`,
      );
    }
    if (!visit.reached.turn)
      return notProvoked("the turn typed into the terminal did not complete");
    const back = sessionOf(cap, 1);
    const saved = JSON.stringify(noteOf<unknown[]>(cap, "savedAfterVisitOne") ?? []);
    const sameId = noteOf<string>(cap, "backInit") === sid;
    const terminalTurnSaved =
      saved.includes("terminal one") ||
      saved.includes("Use the Write tool to overwrite story.txt");
    const answer = back
      ? assistantText(slice(back, noteOf<number>(cap, "backFrom")))
      : "";
    const facts = [
      `the resumed SDK session kept the conversation ID: ${yesNo(sameId)}`,
      `the terminal's turn is in the saved conversation: ${yesNo(terminalTurnSaved)}`,
      ...(run.fake
        ? []
        : [
            `the SDK session after the terminal knew the web's codeword: ${yesNo(/ALBATROSS/i.test(answer))}`,
            `...and the terminal's edit: ${yesNo(/terminal one/i.test(answer))}`,
          ]),
    ];
    if (!sameId || !terminalTurnSaved) {
      return fail("the conversation did not carry across the terminal", facts);
    }
    if (!run.fake && !/ALBATROSS/i.test(answer)) {
      return fail(
        "the SDK session after the terminal did not have the conversation",
        facts,
      );
    }
    return pass("one conversation went SDK session, terminal, SDK session", facts);
  },
};

const rewind: Check = {
  name: "rewind",
  row: "A2",
  title: "/rewind in the terminal restores a file the Agent edited (checkpointing on)",
  scenario: "terminal",
  fakeCannot: "the stub has no /rewind and edits no file",
  assumption:
    "src/agent-runtime/session.ts ClaudeSession: enableFileCheckpointing from the first launch",
  evaluate({ cap }) {
    const visit = noteOf<{ reached: Record<string, boolean> }>(cap, "visitOne");
    if (!visit?.reached.turn)
      return notProvoked(
        "the terminal turn did not complete, so there was nothing to rewind",
      );
    if (!visit.reached.rewindMenu)
      return notProvoked("the /rewind menu did not appear within its timeout");
    if (!visit.reached.rewindPicked)
      return notProvoked("the web's first prompt was not found in the /rewind menu");
    if (!visit.reached.rewindAttempted)
      return notProvoked('"Restore code" was not reached in the menu');
    const facts = [
      `story.txt after the terminal's own edit: ${noteOf<string>(cap, "storyAfterTerminal") === "terminal one" ? "edited" : "not as expected"}`,
    ];
    return visit.reached.rewindRestored
      ? pass(
          "the terminal's /rewind restored the file the web Agent had edited, to before the web's first prompt",
          facts,
        )
      : fail(
          "/rewind did not restore the file: checkpointing from the SDK session is not usable in the terminal",
          facts,
        );
  },
};

const clear: Check = {
  name: "clear",
  row: "A2",
  title: "/clear sent as a prompt starts a new conversation",
  scenario: "clear",
  assumption:
    "src/agent/conversation.ts ConversationTracker (the new ID is the next init's session_id)",
  evaluate({ run, cap }) {
    const session = sessionOf(cap);
    if (!session?.init) return notProvoked("no init was seen");
    const from = noteOf<number>(cap, "clearFrom") ?? 0;
    const after = noteOf<number>(cap, "afterClear") ?? 0;
    const oldId = String(session.init.session_id);
    const reset = session.msgs.slice(from).find((m) => m.type === "conversation_reset");
    if (!reset) return fail("/clear produced no conversation_reset message");
    const clearTurn = session.msgs.slice(from, after);
    const newIdInClearTurn = clearTurn.some(
      (m) =>
        m.type !== "conversation_reset" &&
        typeof m.session_id === "string" &&
        m.session_id !== oldId &&
        m.type !== "result",
    );
    const later = session.msgs.slice(after).find(isInit);
    if (!later) return notProvoked("no init followed the /clear");
    const newId = String(later.session_id);
    // The shipped tracker, fed the log as the runtime would have written it.
    const entries = logOf(session.events);
    const tracker = new ConversationTracker(oldId);
    let atClear = oldId;
    for (const entry of entries) {
      tracker.observe(entry);
      if (
        entry.kind === "sdk" &&
        entry.message.type === "result" &&
        entry.message === clearTurn.find(isResult)
      ) {
        atClear = tracker.id;
      }
    }
    const facts = [
      `the new session ID first appears: ${newIdInClearTurn ? "already at the /clear" : "only at the next turn's init"}`,
      `conversation_reset.new_conversation_id equals the next init's session_id: ${yesNo(reset.new_conversation_id === newId)}`,
      `the tracker is still in the old conversation after the /clear: ${yesNo(atClear === oldId)}`,
      `the tracker is in the new conversation after the next init: ${yesNo(tracker.id === newId)}`,
    ];
    const answer = assistantText(session.msgs.slice(after));
    const forgot = run.fake || /UNKNOWN/i.test(answer);
    if (tracker.id !== newId)
      return fail("ConversationTracker did not end in the new conversation", facts);
    if (newId === oldId) return fail("the next init carries the old session ID", facts);
    if (!forgot)
      return fail("the conversation still remembered what was said before /clear", facts);
    return pass(
      "/clear starts a new conversation, and the tracker follows the next init",
      facts,
    );
  },
};

const atPath: Check = {
  name: "at-path",
  row: "A2",
  title:
    "@path in an SDK prompt is handled as in the TUI; which spelling of a path with a space is expanded",
  scenario: "at-path",
  fakeCannot: "the fake does not expand @path",
  assumption:
    "web/src/agent/fileMentions.ts mentionOf (the spelling the picker inserts for a path with a space)",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const spans = noteOf<Record<string, [number, number]>>(cap, "spans") ?? {};
    const plain = slice(session, noteOf<number>(cap, "plainFrom"), spans.verbatim?.[0]);
    const readTool = (msgs: Msg[]) =>
      toolCalls(msgs).some((call) => /^(Read|Glob|Grep)$/.test(call.name));
    const plainOk = /QUINCE/i.test(assistantText(plain));
    const facts = [
      `plain path: the file's content reached the model without a tool: ${yesNo(plainOk && !readTool(plain))}`,
    ];
    const works: Record<string, boolean> = {};
    for (const { form, token } of SPACE_FORMS) {
      const span = spans[form];
      if (!span) {
        facts.push(`path with a space, ${form}: not tried`);
        continue;
      }
      const msgs = slice(session, span[0], span[1]);
      works[form] = new RegExp(token, "i").test(assistantText(msgs)) && !readTool(msgs);
      facts.push(
        `path with a space, ${form} (${form === "verbatim" ? "@path" : form === "quoted" ? '@"path"' : "@path\\ with\\ escapes"}): expanded without a tool: ${yesNo(works[form] === true)}`,
      );
    }
    if (!plainOk) return fail("@path was not expanded in an SDK prompt", facts);
    // What the shipped picker emits for a path with a space, and whether that spelling was expanded.
    const { mentions } = await webModules();
    const shipped = mentions.mentionOf("a b.txt");
    const spelling = shipped.startsWith('@"')
      ? "quoted"
      : shipped.includes("\\ ")
        ? "escaped"
        : "verbatim";
    facts.push(`web/src/agent/fileMentions.ts mentionOf emits the ${spelling} spelling`);
    if (works[spelling] === undefined) {
      return notProvoked(
        `the ${spelling} spelling the picker emits was not tried`,
        facts,
      );
    }
    if (works[spelling]) {
      return pass(
        `a path with a space is expanded in the spelling the picker emits (${spelling})`,
        facts,
      );
    }
    const other = (["quoted", "escaped", "verbatim"] as const).find(
      (form) => works[form],
    );
    facts.push(
      `the picker should emit ${other ?? "none of the three: they are all unexpanded, so leave such a path out of the picker"}`,
    );
    return fail(
      `the picker's ${spelling} spelling of a path with a space is not expanded (web/src/agent/fileMentions.ts mentionOf)`,
      facts,
    );
  },
};

const goal: Check = {
  name: "goal",
  row: "A2",
  title:
    "/goal typed over streaming input works; the shapes web/src/agent/goal.ts assumes",
  scenario: "goal",
  assumption: "web/src/agent/goal.ts readGoalMessage (SYNTHETIC_MODEL, FEEDBACK_PREFIX)",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    if (noteOf<boolean>(cap, "firstResult") !== true)
      return fail("/goal over streaming input produced no result");
    const setMessage = session.msgs.find(
      (m) =>
        m.type === "assistant" && textOfContent(m).trimStart().startsWith("Goal set:"),
    );
    const checkIn = session.msgs.find(
      (m) =>
        m.type === "user" &&
        !blocks(m).some((b) => b.type === "tool_result") &&
        textOfContent(m).trimStart().startsWith("Stop hook feedback:"),
    );
    const model = isObject(setMessage?.message)
      ? String(setMessage?.message.model)
      : "none";
    const items = await itemsOf(session);
    const kinds = new Set(items.map((item) => item.kind));
    const facts = [
      `"Goal set:" message found: ${yesNo(setMessage !== undefined)}${setMessage ? `, its model: ${model}` : ""}`,
      `a "Stop hook feedback:" check-in came: ${yesNo(checkIn !== undefined)}${checkIn ? ` (isReplay ${String(checkIn.isReplay)}, isSynthetic ${String(checkIn.isSynthetic)})` : ""}`,
      `the Transcript shows goal-set: ${yesNo(kinds.has("goal-set"))}, goal-check-in: ${yesNo(kinds.has("goal-check-in"))}`,
      `the session carried on by itself after the first result: ${yesNo(noteOf<boolean>(cap, "more") === true)}`,
    ];
    if (!setMessage) return fail('no assistant message starts with "Goal set:"', facts);
    if (model !== "<synthetic>")
      return fail(`the "Goal set:" message's model is ${model}, not <synthetic>`, facts);
    if (!kinds.has("goal-set"))
      return fail("the Transcript did not build a goal line from it", facts);
    if (checkIn && !kinds.has("goal-check-in"))
      return fail("a check-in message did not become a goal check-in line", facts);
    return pass(
      checkIn
        ? "/goal works and both shapes are as assumed"
        : "/goal works and its Goal-set shape is as assumed (no check-in came: the goal was met first time)",
      facts,
    );
  },
};

const loop: Check = {
  name: "loop",
  row: "A2",
  title: "/loop typed over streaming input works (one iteration, then stopped)",
  scenario: "loop",
  assumption:
    "web/src/agent/goal.ts (comment: /loop needs nothing); src/agent-runtime/activity.ts Activity",
  evaluate({ run, cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    if (noteOf<boolean>(cap, "firstResult") !== true)
      return fail("/loop over streaming input produced no result");
    const tools = [...new Set(toolCalls(session.msgs).map((call) => call.name))];
    const facts = [
      `tools the first iteration used: ${tools.join(", ") || "none"}`,
      ...(run.fake
        ? [
            `a second turn started by itself: ${yesNo(noteOf<boolean>(cap, "spontaneous") === true)}`,
          ]
        : []),
    ];
    const denied = session.asks
      .filter((ask) => ask.decision === "deny")
      .map((ask) => ask.toolName);
    if (denied.length > 0) {
      return notProvoked(
        `the check denied ${denied.join(", ")}, which /loop may need`,
        facts,
      );
    }
    return pass(
      "/loop ran its first iteration; the session was then interrupted and closed",
      facts,
    );
  },
};

// ---- A3 --------------------------------------------------------------------------------

const unavailableReply: Check = {
  name: "unavailable-reply",
  row: "A3",
  title: 'The wording and carrier of "isn\'t available in this environment"',
  scenario: "baseline",
  assumption:
    "web/src/agent/unsupported.ts unavailableCommand (UNAVAILABLE and its three carriers)",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const msgs = slice(
      session,
      noteOf<number>(cap, "unavailableFrom"),
      noteOf<number>(cap, "unavailableTo"),
    );
    const { unsupported } = await webModules();
    const mentions = msgs.filter((m) =>
      /isn['’]t available in this environment/i.test(JSON.stringify(m)),
    );
    if (mentions.length === 0) {
      return notProvoked(
        "/plugin was available (or answered otherwise), so there was no such reply to see",
        [`carriers seen: ${[...new Set(msgs.map(carrier))].join(", ")}`],
      );
    }
    const found = msgs
      .flatMap((m) => unsupported.unsupportedInMessage(m))
      .filter((u) => u.what === "command");
    const facts = [
      `carrier: ${[...new Set(mentions.map(carrier))].join(", ")}`,
      `recognised as a command row: ${yesNo(found.length > 0)}`,
    ];
    return found.length > 0
      ? pass(
          "the reply is in a carrier unsupported.ts reads, with the wording it matches",
          facts,
        )
      : fail(
          "the reply came in a carrier or wording unsupported.ts does not match",
          facts,
        );
  },
};

const commandOutput: Check = {
  name: "command-output",
  row: "A3",
  title: "A typed command's reply (/model) is a carrier the Transcript shows",
  scenario: "baseline",
  assumption: "web/src/agent/items.ts CommandOutputItem (system/local_command_output)",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const msgs = slice(
      session,
      noteOf<number>(cap, "modelFrom"),
      noteOf<number>(cap, "unavailableFrom"),
    );
    const carriers = [...new Set(msgs.map(carrier))];
    const items = await itemsOf(session);
    const shown = items.some((item) => item.kind === "command_output");
    const facts = [
      `carriers in the /model turn: ${carriers.join(", ")}`,
      `a command_output line is built: ${yesNo(shown)}`,
    ];
    if (
      !msgs.some((m) =>
        /local-command-stdout|local_command_output/.test(JSON.stringify(m)),
      )
    ) {
      return notProvoked("/model produced no local command output to see", facts);
    }
    return shown
      ? pass("the reply is a command_output line", facts)
      : fail("the reply is in a carrier the Transcript does not turn into a line", facts);
  },
};

const modelCommand: Check = {
  name: "model-command",
  row: "A3",
  title: "/model <name> is followed by a system/init with the new model",
  scenario: "baseline",
  assumption:
    "web/src/agent/items.ts BuiltTranscript.model (the header follows the latest init)",
  evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const msgs = slice(
      session,
      noteOf<number>(cap, "modelFrom"),
      noteOf<number>(cap, "unavailableFrom"),
    );
    const init = msgs.find(isInit);
    const facts = [
      `an init follows /model: ${yesNo(init !== undefined)}${init ? `, its model: ${String(init.model)}` : ""}`,
    ];
    return init
      ? pass(
          "an init with the model follows the local command, so the header follows it",
          facts,
        )
      : fail(
          "no system/init follows /model: the header keeps the old model until the next turn",
          facts,
        );
  },
};

const contextLeft: Check = {
  name: "context-left",
  row: "A3",
  title: "The unit of autoCompactThreshold (the status line assumes tokens)",
  scenario: "baseline",
  assumption:
    "web/src/agent/activity.ts contextLeftPercent; src/agent-runtime/session.ts contextUsage",
  async evaluate({ cap }) {
    const usage = noteOf<Record<string, unknown>>(cap, "context");
    if (!usage) {
      return notProvoked(
        `getContextUsage gave nothing (${noteOf<string>(cap, "contextError") ?? "no reason"}): the status line shows nothing`,
      );
    }
    const { activity } = await webModules();
    const threshold = usage.autoCompactThreshold;
    const max = Number(usage.maxTokens);
    const total = Number(usage.totalTokens);
    const percent = activity.contextLeftPercent({
      totalTokens: total,
      maxTokens: max,
      percentage: Number(usage.percentage),
      isAutoCompactEnabled: Boolean(usage.isAutoCompactEnabled),
      ...(typeof threshold === "number" ? { autoCompactThreshold: threshold } : {}),
    });
    const facts = [
      `autoCompactThreshold present: ${yesNo(typeof threshold === "number")}`,
      `auto-compact enabled: ${yesNo(Boolean(usage.isAutoCompactEnabled))}`,
      typeof threshold === "number"
        ? `threshold / window: ${(threshold / max).toFixed(2)}`
        : "threshold / window: n/a",
      `"context left" the status line shows: ${percent === undefined ? "nothing" : `${percent}%`}`,
    ];
    if (typeof threshold !== "number")
      return notProvoked(
        "Claude Code gave no autoCompactThreshold to read a unit from",
        facts,
      );
    if (threshold <= 1)
      return fail("autoCompactThreshold looks like a fraction, not tokens", facts);
    if (threshold < 100 && max > 1000)
      return fail("autoCompactThreshold looks like a percentage, not tokens", facts);
    if (threshold > max)
      return fail(
        "autoCompactThreshold is larger than the window: not tokens of this window",
        facts,
      );
    return pass(
      "autoCompactThreshold is in tokens of the window, as the status line assumes",
      facts,
    );
  },
};

const terminalCommands: Check = {
  name: "terminal-commands",
  row: "A3",
  title:
    "terminal_slash_commands first appears on a turn's init, not the initialize reply",
  scenario: "baseline",
  assumption:
    "src/agent-runtime/commands.ts CommandList (the / menu shows them until the first turn)",
  evaluate({ cap }) {
    const reply = noteOf<Record<string, unknown>>(cap, "initReply");
    const init = noteOf<Msg>(cap, "firstInit");
    if (!reply || !init) return notProvoked("no initialize reply or init was seen");
    const inReply = "terminal_slash_commands" in reply;
    const names = Array.isArray(init.terminal_slash_commands)
      ? init.terminal_slash_commands.filter((n): n is string => typeof n === "string")
      : [];
    const list = new CommandList();
    list.set(reply.commands);
    const before = list.commands.length;
    list.observe(init);
    const after = list.commands.length;
    // What should be hidden: the listed commands, however the names are spelled (with the slash or not).
    const bare = new Set(names.map((name) => name.replace(/^\//, "")));
    const rows = Array.isArray(reply.commands) ? (reply.commands as unknown[]) : [];
    const hideable = rows.filter(
      (row) =>
        isObject(row) &&
        typeof row.name === "string" &&
        bare.has(row.name.replace(/^\//, "")),
    ).length;
    const facts = [
      `in the initialize reply: ${yesNo(inReply)}`,
      `terminal-only commands on the first init: ${names.length}${names.some((n) => n.startsWith("/")) ? " (spelled with a slash)" : " (spelled without a slash)"}`,
      `commands offered before / after the first init: ${before} / ${after}`,
      `of the terminal-only ones, in the command list: ${hideable}`,
    ];
    if (inReply)
      return fail(
        "the initialize reply already names terminal-only commands: the menu could hide them from the start",
        facts,
      );
    if (names.length === 0)
      return notProvoked("the first init named no terminal-only command", facts);
    if (hideable === 0)
      return notProvoked(
        "none of the terminal-only names is in the command list to hide",
        facts,
      );
    return before - after === hideable
      ? pass("they come only on a turn's init, and CommandList then hides them", facts)
      : fail(
          "the init named terminal-only commands but CommandList hid fewer than it should: the spelling differs from the command list's",
          facts,
        );
  },
};

const sessionState: Check = {
  name: "session-state",
  row: "A3",
  title: "session_state_changed: emitted at all, and for a turn nobody sent",
  scenario: "loop",
  assumption: "src/agent-runtime/activity.ts Activity (Working must be right either way)",
  evaluate({ cap, all }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const states = session.msgs
      .filter((m) => isSystem(m, "session_state_changed"))
      .map((m) => String(m.state));
    const baseline = all.get("baseline")?.sessions[0];
    const baselineStates = baseline
      ? baseline.msgs.filter((m) => isSystem(m, "session_state_changed")).length
      : 0;
    const publish = activityStates(session.events);
    const final = publish.at(-1);
    const afterFirstResult = session.msgs
      .slice(session.msgs.findIndex(isResult) + 1)
      .some((m) => isSystem(m, "session_state_changed") && m.state === "running");
    const facts = [
      `emitted at all: ${yesNo(states.length > 0 || baselineStates > 0)}`,
      `states seen: ${[...new Set(states)].join(", ") || "none"}`,
      `for a turn nobody sent (after the first result): ${afterFirstResult ? "yes" : "not seen (the run stops after one iteration)"}`,
      `Activity's states while reading: ${[...new Set(publish)].join(" > ")}`,
    ];
    if (!publish.includes("working"))
      return fail("Activity never read Working during a turn", facts);
    if (final !== "idle")
      return fail(`Activity ended ${final}, not idle, after the turn ended`, facts);
    return pass(
      "Activity reads Working while a turn runs and Idle after it, whether or not session_state_changed comes",
      facts,
    );
  },
};

const midturnSend: Check = {
  name: "midturn-send",
  row: "A3",
  title: "A message sent during a tool-using turn: which signal clears (queued)",
  scenario: "midturn",
  assumption:
    "web/src/agent/prompts.ts queuedPromptIds (pickedUp: command_lifecycle, replayed echo, user_message_uuids)",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    const ids = noteOf<{ first: string; second: string }>(cap, "ids");
    if (!session || !ids) return notProvoked("the session did not run");
    if (noteOf<boolean>(cap, "sentDuringTool") !== true) {
      return notProvoked(
        "the first turn ended before the second prompt could be sent mid-turn",
      );
    }
    const from = noteOf<number>(cap, "from") ?? 0;
    const msgs = session.msgs.slice(from);
    const results = msgs.filter(isResult).length;
    const completed = noteOf<number>(cap, "completed") ?? 0;
    const lifecycle = msgs
      .filter((m) => m.type === "command_lifecycle" && m.command_uuid === ids.second)
      .map((m) => String(m.state));
    const echoIndex = msgs.findIndex(
      (m) => m.type === "user" && m.isReplay === true && m.uuid === ids.second,
    );
    const stamped = msgs.filter(
      (m) =>
        m.user_message_uuid === ids.second ||
        (Array.isArray(m.user_message_uuids) &&
          m.user_message_uuids.includes(ids.second)),
    );
    const firstResult = msgs.findIndex(isResult);
    const pickupAt = msgs.findIndex(
      (m) =>
        (m.type === "command_lifecycle" &&
          m.command_uuid === ids.second &&
          m.state !== "queued") ||
        (m.type === "user" && m.isReplay === true && m.uuid === ids.second) ||
        m.user_message_uuid === ids.second ||
        (Array.isArray(m.user_message_uuids) &&
          m.user_message_uuids.includes(ids.second)),
    );
    const { prompts } = await webModules();
    const queued = prompts.queuedPromptIds(logOf(session.events));
    const facts = [
      `results: ${results} (a prompt folded into the running turn shares its result), prompts completed: ${completed} of 2`,
      `command_lifecycle states for the second prompt: ${lifecycle.join(", ") || "none"}`,
      `its replayed echo came: ${yesNo(echoIndex >= 0)}`,
      `user_message_uuids named it on a frame: ${yesNo(stamped.length > 0)}${stamped.length > 0 ? ` (${[...new Set(stamped.map(carrier))].join(", ")})` : ""}`,
      `folded into the running turn (picked up before the first result): ${yesNo(pickupAt >= 0 && firstResult >= 0 && pickupAt < firstResult)}`,
      `still shown (queued) afterwards: ${yesNo(queued.has(ids.second))}`,
    ];
    if (completed < 2)
      return notProvoked("the second prompt did not complete in time", facts);
    return queued.size === 0
      ? pass("some signal clears (queued) for a prompt sent mid-turn", facts)
      : fail(
          "a prompt sent mid-turn stayed (queued): none of the signals queuedPromptIds reads came for it",
          facts,
        );
  },
};

const denyReply: Check = {
  name: "deny-reply",
  row: "A3",
  title: "Deny with a reply: the wording is what Claude Code itself sends",
  scenario: "terminal",
  assumption: "src/agent-runtime/asks.ts DENIED_WITH_REPLY",
  evaluate({ cap }) {
    const visit = noteOf<{ reached: Record<string, boolean> }>(cap, "visitOne");
    if (!visit?.reached.deniedWithReply)
      return notProvoked("the terminal's denial-with-a-reply menu was not reached");
    const saved = (noteOf<unknown[]>(cap, "savedAfterVisitOne") ?? []) as SavedMessage[];
    const texts: string[] = [];
    for (const message of saved) {
      const inner = isObject(message.message) ? message.message : {};
      const content = Array.isArray(inner.content) ? inner.content : [];
      for (const block of content) {
        if (isObject(block) && block.type === "tool_result" && block.is_error === true) {
          const body = block.content;
          texts.push(typeof body === "string" ? body : JSON.stringify(body));
        }
      }
    }
    const own = texts.find((text) => text.includes(DENY_FEEDBACK));
    if (!own)
      return notProvoked(
        "no denied tool result carrying the reply was found in the saved conversation",
        [`denied tool results seen: ${texts.length}`],
      );
    const same = own.startsWith(DENIED_WITH_REPLY) && own.endsWith(DENY_FEEDBACK);
    const facts = [
      `Claude Code's own text: "${own.slice(0, 260).replace(/\n/g, "\\n")}"`,
    ];
    return same
      ? pass("k-bench's wording is what Claude Code itself sends", facts)
      : fail(
          "Claude Code's own wording differs from DENIED_WITH_REPLY: update it",
          facts,
        );
  },
};

/** What the TUI's footer says for each mode (`manual mode on` is the default one). */
const FOOTER_LABEL: Record<string, string> = {
  default: "manual mode on",
  acceptEdits: "accept edits on",
  plan: "plan mode on",
  auto: "auto mode on",
};

const modeCycle: Check = {
  name: "mode-cycle",
  row: "A3",
  title:
    "k-bench's permission-mode cycle equals the one the TUI offers (auto where the model supports it)",
  scenario: "terminal",
  fakeCannot: "the stub has no mode cycle",
  assumption:
    "src/shared/agent-protocol.ts PERMISSION_MODE_CYCLE, permissionModeCycle; src/agent-runtime/mode.ts autoModeSupported",
  evaluate({ cap, all }) {
    const visit = noteOf<{ cycle: string[]; reached: Record<string, boolean> }>(
      cap,
      "visitTwo",
    );
    const base = all.get("baseline");
    const models = noteOf<Record<string, unknown>>(base ?? cap, "initReply")?.models;
    // The list comes from the baseline scenario's first reply; a run that did not include it
    // (--only) has nothing to compare with, which is not a failure.
    if (!Array.isArray(models))
      return notProvoked(
        "this run has no model list (the baseline scenario did not run): add `baseline` to --only",
        [],
      );
    // The model the Session runs on is Haiku: the same lookup the runtime makes.
    const supportsAuto = autoModeSupported(models, undefined, "haiku");
    const ours = permissionModeCycle(supportsAuto).map(
      (mode) => FOOTER_LABEL[mode] ?? mode,
    );
    const facts = [
      `the model list says Haiku supports auto mode: ${yesNo(supportsAuto)}`,
      `the SDK accepted setPermissionMode("auto"): ${base ? yesNo(noteOf<boolean>(base, "autoAccepted") === true) : "unknown"}`,
      `k-bench's cycle for this model, as footer labels: ${ours.join(" > ")}`,
    ];
    if (!visit?.reached.cycle)
      return notProvoked("the terminal's Shift+Tab cycle was not read", facts);
    facts.push(`the TUI's cycle (footer labels): ${visit.cycle.join(" > ")}`);
    return visit.cycle.join(" > ") === ours.join(" > ")
      ? pass("k-bench's cycle is the TUI's, in the same order", facts)
      : fail(
          "k-bench's cycle differs from the TUI's: fix permissionModeCycle (src/shared/agent-protocol.ts)",
          facts,
        );
  },
};

/**
 * The shape of the first messages of a saved conversation, kinds only: type, subtype, role,
 * what the content is made of, which flags are present and which other fields there are, never
 * a text. For setting the compaction heuristic (src/agent-runtime/terminal-import.ts) from evidence.
 */
function chainShape(saved: readonly unknown[]): string[] {
  const rows = saved.slice(0, 8).map((m, i) => {
    const row = isObject(m) ? m : {};
    const inner = isObject(row.message) ? row.message : {};
    const content =
      typeof inner.content === "string"
        ? "string"
        : Array.isArray(inner.content)
          ? inner.content.map((b) => (isObject(b) ? String(b.type) : "?")).join("+")
          : "none";
    const flags = [
      "isCompactSummary",
      "isSynthetic",
      "isMeta",
      "isSidechain",
      "isReplay",
      "isVisibleInTranscriptOnly",
    ]
      .filter((key) => key in row)
      .map((key) => `${key}=${String(row[key])}`);
    const others = Object.keys(row)
      .filter((key) => key !== "message")
      .sort()
      .join("|");
    return `#${i} ${String(row.type)}${typeof row.subtype === "string" ? `/${row.subtype}` : ""} role=${typeof inner.role === "string" ? inner.role : "none"} content=${content}${flags.length > 0 ? ` ${flags.join(",")}` : ""} fields=${others}`;
  });
  return [
    `the chain after the terminal's /compact has ${saved.length} message(s); the first ${rows.length}, kinds only:`,
    ...rows,
  ];
}

const openInWebAnchors: Check = {
  name: "open-in-web-anchors",
  row: "A3",
  title:
    "The saved transcript keeps the client-set uuids, a terminal /compact is said, and its summary is not shown as a prompt",
  scenario: "terminal",
  assumption:
    "src/agent-runtime/terminal-import.ts planTerminalImport (anchors on prompt ids; the compaction heuristic)",
  async evaluate({ cap }) {
    const web = sessionOf(cap, 0);
    const ids = noteOf<{ first: string; second: string }>(cap, "ids");
    const saved1 = (noteOf<unknown[]>(cap, "savedAfterVisitOne") ?? []) as SavedMessage[];
    const saved2 = (noteOf<unknown[]>(cap, "savedAfterCompact") ?? []) as SavedMessage[];
    if (!web || !ids || saved1.length === 0)
      return notProvoked("the conversation was not read back after the terminal");
    const visitOne = noteOf<{ reached: Record<string, boolean> }>(cap, "visitOne");
    if (!visitOne?.reached.turn) {
      return notProvoked(
        "the terminal turn did not happen, so there was nothing to import",
      );
    }
    const savedIds = new Set(saved1.map((m) => m.uuid));
    const streamed = web.msgs
      .filter((m) => m.type === "assistant" && typeof m.uuid === "string")
      .map((m) => String(m.uuid));
    const matched = streamed.filter((id) => savedIds.has(id)).length;
    const log = logOf(web.events);
    const imported = planTerminalImport(log, saved1);
    const labels = imported
      .filter((entry) => entry.kind === "divider")
      .map((entry) => (entry as { label: string }).label);
    const importedUuids = imported.flatMap((entry) =>
      entry.kind === "sdk" && typeof entry.message.uuid === "string"
        ? [entry.message.uuid]
        : [],
    );
    const duplicates = importedUuids.filter((id) =>
      log.some((entry) => entry.kind === "sdk" && entry.message.uuid === id),
    );
    const facts = [
      `the web's two client-set prompt uuids are in the saved transcript: ${yesNo(savedIds.has(ids.first) && savedIds.has(ids.second))}`,
      `streamed assistant uuids found in the saved transcript: ${matched} of ${streamed.length}`,
      `the import adds ${importedUuids.length} message(s) between dividers: ${labels.join(" / ") || "none"}`,
      `...of which already in the log (duplicates): ${duplicates.length}`,
    ];
    if (!(savedIds.has(ids.first) && savedIds.has(ids.second))) {
      return fail(
        "the saved transcript does not keep the client-set prompt uuids: the import cannot anchor on them",
        facts,
      );
    }
    if (streamed.length > 0 && matched === 0)
      return fail("the streamed assistant uuids are not the saved ones", facts);
    if (imported.length === 0 || duplicates.length > 0) {
      return fail(
        "the import found nothing new, or duplicated what the log holds",
        facts,
      );
    }
    // The compaction heuristic: a chain that starts with a system message.
    const visitTwo = noteOf<{ reached: Record<string, boolean> }>(cap, "visitTwo");
    if (visitTwo?.reached.compacted) facts.push(...chainShape(saved2));
    if (saved2.length === 0 || !visitTwo?.reached.compacted) {
      return notProvoked(
        "the terminal's /compact did not happen or was not read back",
        facts,
      );
    }
    const startsWithSystem = saved2[0]?.type === "system";
    const entries = [
      ...log,
      ...imported.map((entry, index) => ({
        ...entry,
        seq: log.length + index + 1,
        t: new Date().toISOString(),
      })),
    ] as Parameters<typeof planTerminalImport>[0];
    const compacted = planTerminalImport(entries, saved2);
    const first =
      compacted[0]?.kind === "divider" ? (compacted[0] as { label: string }).label : "";
    const after = compacted.flatMap((entry) =>
      entry.kind === "sdk" ? [entry.message] : [],
    );
    const knownUuids = new Set(
      entries.flatMap((entry) =>
        entry.kind === "sdk" && typeof entry.message.uuid === "string"
          ? [entry.message.uuid]
          : [],
      ),
    );
    const summaries = after.filter((m) => m.isCompactSummary === true);
    const summaryAsPrompt = summaries.some((m) => m.isReplay === true);
    const localAsPrompt = after.some(
      (m) => m.isCompletedLocalCommand === true && m.isReplay === true,
    );
    const again = after.filter((m) => knownUuids.has(String(m.uuid))).length;
    facts.push(
      `the chain after the terminal's /compact starts with a system message: ${yesNo(startsWithSystem)}`,
      `the import after the compaction says: ${first || "nothing"}`,
      `it imports ${after.length} message(s): ${summaries.length} compaction summary(ies), ${after.filter((m) => m.isCompletedLocalCommand === true).length} local-command output(s)`,
      `a summary is shown as something the owner typed: ${yesNo(summaryAsPrompt)}; a local command's output is: ${yesNo(localAsPrompt)}`,
      `messages imported that the log already holds: ${again}`,
    );
    if (!startsWithSystem)
      return fail(
        "a terminal /compact does not start the saved chain with a system message",
        facts,
      );
    if (!/Compacted in the terminal/.test(first))
      return fail(
        "planTerminalImport did not say the terminal compacted (src/agent-runtime/terminal-import.ts)",
        facts,
      );
    if (summaries.length === 0)
      return fail("the compaction summary was not imported as a summary", facts);
    if (summaryAsPrompt || localAsPrompt)
      return fail(
        "Claude Code's own summary or command output would show as something the owner typed",
        facts,
      );
    if (again > 0) return fail("the import repeats messages the log holds", facts);
    return pass(
      "the uuids anchor the import, and a compaction in the terminal is said, with its summary kept as Claude's own",
      facts,
    );
  },
};

/** The tasks Claude Code's messages say are running after these messages: the whole list of `background_tasks_changed`, each backgrounded `task_started`, less each ended one. */
function aliveAt(msgs: readonly Msg[]): Set<string> {
  const alive = new Set<string>();
  for (const m of msgs) {
    if (isSystem(m, "background_tasks_changed")) {
      alive.clear();
      for (const t of Array.isArray(m.tasks) ? m.tasks : []) {
        if (isObject(t) && typeof t.task_id === "string") alive.add(t.task_id);
      }
    } else if (isSystem(m, "task_started") && m.is_backgrounded === true) {
      alive.add(String(m.task_id));
    } else if (isSystem(m, "task_notification")) {
      alive.delete(String(m.task_id));
    }
  }
  return alive;
}

const tasks: Check = {
  name: "tasks",
  row: "A3",
  title:
    "Subagent and background task messages: is_backgrounded and background_tasks_changed agree, a background task shows until Claude Code says it ended; stopTask; what Interrupt does with perTaskStopAffordance",
  scenario: "tasks",
  assumption:
    "src/agent-runtime/tasks.ts TaskTracker; web/src/agent/tasks.ts TaskBuilder; src/agent-runtime/session.ts perTaskStopAffordance",
  evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const fgFrom = noteOf<number>(cap, "foregroundFrom") ?? 0;
    const fgTo = noteOf<number>(cap, "foregroundTo") ?? session.msgs.length;
    const fg = session.msgs.slice(fgFrom, fgTo);
    const started = fg.find(
      (m) => isSystem(m, "task_started") && m.task_type === "local_agent",
    );
    if (!started)
      return notProvoked("the model did not start a subagent", [
        `tools called: ${
          toolCalls(fg)
            .map((c) => c.name)
            .join(", ") || "none"
        }`,
      ]);
    const idsOf = (m: Msg) =>
      Array.isArray(m.tasks)
        ? m.tasks.flatMap((t) =>
            isObject(t) && typeof t.task_id === "string" ? [t.task_id] : [],
          )
        : [];
    const inLevel = session.msgs.some(
      (m) =>
        isSystem(m, "background_tasks_changed") &&
        idsOf(m).includes(String(started.task_id)),
    );
    const launchedAsync = fg.some(
      (m) =>
        m.type === "user" &&
        isObject(m.tool_use_result) &&
        (m.tool_use_result.isAsync === true ||
          m.tool_use_result.status === "async_launched"),
    );
    // What Claude Code's messages say is alive at each `result`, from the messages alone: a
    // backgrounded task stays until a notification (or a terminal update) ends it, and
    // `background_tasks_changed` is the whole list. TaskTracker must say the same.
    const tracker = new TaskTracker();
    const alive = new Set<string>();
    let results = 0;
    let disagreed = 0;
    for (const m of session.msgs) {
      tracker.observe(m as never);
      if (isSystem(m, "background_tasks_changed")) {
        alive.clear();
        for (const id of idsOf(m)) alive.add(id);
      } else if (isSystem(m, "task_started") && m.is_backgrounded === true) {
        alive.add(String(m.task_id));
      } else if (isSystem(m, "task_notification")) {
        alive.delete(String(m.task_id));
      } else if (
        isSystem(m, "task_updated") &&
        isObject(m.patch) &&
        ["completed", "failed", "killed"].includes(String(m.patch.status))
      ) {
        alive.delete(String(m.task_id));
      } else if (isResult(m)) {
        results += 1;
        const got = tracker.list
          .map((task) => task.id)
          .sort()
          .join(",");
        if (got !== [...alive].sort().join(",")) disagreed += 1;
      }
    }
    const resultAt = session.msgs.findIndex((m, i) => i >= fgFrom && isResult(m));
    const endedBeforeResult = session.msgs.findIndex(
      (m) => isSystem(m, "task_notification") && m.task_id === started.task_id,
    );
    const facts = [
      `the subagent's task_started says is_backgrounded = ${String(started.is_backgrounded)}`,
      `the Agent tool's result says it launched asynchronously: ${yesNo(launchedAsync)}`,
      `it is listed in background_tasks_changed: ${yesNo(inLevel)}`,
      `its task_notification came ${endedBeforeResult >= 0 && endedBeforeResult < resultAt ? "before" : "after"} the turn's result`,
      `TaskTracker agreed with the messages at ${results - disagreed} of ${results} results`,
    ];
    let outcome: Outcome | undefined;
    if ((started.is_backgrounded === true) !== inLevel)
      outcome = fail(
        "is_backgrounded and background_tasks_changed disagree about the subagent",
        facts,
      );
    else if (disagreed > 0)
      outcome = fail(
        "TaskTracker's list differs from what the messages say is still running",
        facts,
      );
    // The background command.
    const bgId = noteOf<string>(cap, "backgroundId");
    if (noteOf<boolean>(cap, "bashSkipped") === true) {
      facts.push("background command: not run (the owner's settings allow Bash broadly)");
    } else if (!bgId) {
      facts.push(
        "background command: the model did not start one (or the fixed command was refused)",
      );
    } else {
      const interrupt = session.msgs.slice(
        noteOf<number>(cap, "interruptFrom") ?? 0,
        noteOf<number>(cap, "interruptTo") ?? undefined,
      );
      const killed = interrupt.some(
        (m) => isSystem(m, "task_notification") && m.task_id === bgId,
      );
      const stopMsgs = session.msgs.slice(
        noteOf<number>(cap, "stopFrom") ?? session.msgs.length,
      );
      const stopped = stopMsgs.find(
        (m) => isSystem(m, "task_notification") && m.task_id === bgId,
      );
      facts.push(
        `an interrupt mid-turn left the background task running (perTaskStopAffordance): ${yesNo(!killed)}`,
      );
      facts.push(
        `stopTask accepted: ${yesNo(noteOf<boolean>(cap, "stopAccepted") === true)}; a task_notification followed: ${yesNo(stopped !== undefined)}${stopped ? ` (status ${String(stopped.status)})` : ""}`,
      );
      const tried = noteOf<number>(cap, "stopFrom") !== undefined;
      // Was the task still running when stopTask was tried? Replayed from the messages alone.
      const stillListed = aliveAt(
        session.msgs.slice(0, noteOf<number>(cap, "stopFrom") ?? 0),
      ).has(bgId);
      facts.push(
        `the background task was still listed when stopTask was tried: ${tried ? yesNo(stillListed) : "stopTask was not tried"}`,
      );
      if (!outcome && !tried) {
        outcome = notProvoked(
          `stopTask was not tried: ${noteOf<string>(cap, "stopSkipped") ?? "no stop was possible"}`,
          facts,
        );
      } else if (!outcome && noteOf<boolean>(cap, "stopAccepted") !== true) {
        outcome = stillListed
          ? fail("stopTask on a live background task was refused", facts)
          : notProvoked("the task ended before it could be stopped", facts);
      } else if (!outcome && !stopped) {
        outcome = fail("stopTask was accepted but no task_notification followed", facts);
      }
    }
    return outcome ?? pass("the task shapes are as TaskTracker assumes", facts);
  },
};

const compaction: Check = {
  name: "compaction",
  row: "A3",
  title: "Compaction over the SDK (/compact): the status and compact_boundary shapes",
  scenario: "compaction",
  assumption:
    "web/src/agent/uncommon.ts compaction (status compacting, compact_boundary.compact_metadata)",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const msgs = session.msgs.slice(noteOf<number>(cap, "from") ?? 0);
    const boundary = msgs.find((m) => isSystem(m, "compact_boundary"));
    if (!boundary)
      return notProvoked("no compact_boundary came (nothing to compact, or it failed)", [
        `messages in the turn: ${[...new Set(msgs.map(carrier))].join(", ")}`,
      ]);
    const item = (await itemsOf(session)).find((i) => i.kind === "compaction");
    const facts = [
      `a status "compacting" came first: ${yesNo(msgs.some((m) => isSystem(m, "status") && m.status === "compacting"))}`,
      `compact_metadata fields: ${isObject(boundary.compact_metadata) ? Object.keys(boundary.compact_metadata).join(", ") : "none"}`,
      `the Transcript's line: ${item ? String(item.state) : "none"}`,
    ];
    return item && item.state === "done"
      ? pass("the compaction line is built from the real messages", facts)
      : fail(
          "the real compaction messages did not become a finished compaction line",
          facts,
        );
  },
};

const todowrite: Check = {
  name: "todowrite",
  row: "A3",
  title: "TodoWrite: a real example becomes a task list",
  scenario: "clear",
  assumption: "web/src/agent/uncommon.ts readTodoWrite",
  async evaluate({ cap }) {
    const session = sessionOf(cap);
    if (!session) return notProvoked("the session did not run");
    const called = toolCalls(session.msgs).some((call) => call.name === "TodoWrite");
    if (!called) return notProvoked("the model did not call TodoWrite");
    const item = (await itemsOf(session)).find((i) => i.kind === "todos");
    return item
      ? pass("a real TodoWrite call becomes a task list line")
      : fail("a real TodoWrite call did not become a task list line");
  },
};

const folderTrust: Check = {
  name: "folder-trust",
  row: "A3",
  title: "The folder-trust warning's real shape",
  scenario: "baseline",
  assumption: "web/src/agent/uncommon.ts (shown as a generic Warning)",
  evaluate({ all }) {
    const seen = [...all.values()].some((cap) =>
      cap.sessions.some((s) =>
        s.msgs.some(
          (m) =>
            /trust/i.test(JSON.stringify(m)) &&
            m.type === "system" &&
            m.subtype !== "init",
        ),
      ),
    );
    return notProvoked(
      "it needs a folder Claude Code has never trusted, and the check works in a throwaway folder on purpose; the shape stays marked from SDK types",
      [`a system message mentioning trust came incidentally: ${yesNo(seen)}`],
    );
  },
};

const uncommonKinds: Check = {
  name: "uncommon-kinds",
  row: "A3",
  title:
    "Usage limit, API retry, MCP and notices: a real example of each that came cheaply",
  scenario: "baseline",
  assumption:
    "web/src/agent/uncommon.ts (these stay marked 'from SDK types' in docs/internals/test-seams.md unless seen)",
  evaluate({ all }) {
    const kinds = new Set<string>();
    for (const cap of all.values())
      for (const s of cap.sessions) for (const m of s.msgs) kinds.add(carrier(m));
    const seen = [
      "system/api_retry",
      "system/notification",
      "system/informational",
      "rate_limit_event",
      "system/hook_started",
      "system/permission_denied",
    ].filter((k) => kinds.has(k));
    return notProvoked(
      "usage limits, retries and MCP activity are costly or unsafe to provoke on purpose",
      [`seen incidentally: ${seen.join(", ") || "none"}`],
    );
  },
};

const knownKinds: Check = {
  name: "known-kinds",
  row: "A3",
  title:
    "Every real message kind produces no Unsupported item (known kinds are recognised)",
  scenario: "baseline",
  assumption: "web/src/agent/unsupported.ts MESSAGE_TYPES, SYSTEM_SUBTYPES, BLOCK_TYPES",
  async evaluate({ all }) {
    const unknown = new Map<string, number>();
    let messages = 0;
    for (const cap of all.values()) {
      for (const session of cap.sessions) {
        for (const item of await itemsOf(session)) {
          if (item.kind !== "unsupported") continue;
          // The ones expected: /plugin is sent on purpose, and may be listed as terminal-only.
          if (item.what === "command" || item.what === "terminal-command") continue;
          const label = `${String(item.what)}:${String(item.name)}`;
          unknown.set(label, (unknown.get(label) ?? 0) + 1);
        }
        messages += session.msgs.length;
      }
    }
    const facts = [
      `messages read: ${messages}`,
      `Unsupported rows by kind: ${[...unknown].map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`,
    ];
    return unknown.size === 0
      ? pass(
          "every message and block in the recordings is a kind k-bench recognises",
          facts,
        )
      : fail(
          "real messages produced Unsupported rows: add these kinds to the tables in unsupported.ts or handle them",
          facts,
        );
  },
};

const denyList: Check = {
  name: "deny-list",
  row: "rail",
  title:
    "The deny list: MCP tools, writes outside the folder and unlisted commands are denied",
  scenario: "rails",
  assumption: "scripts/live-check/rails.ts decideTool",
  evaluate({ cap }) {
    const asks = noteOf<Array<{ tool: string; decision: string }>>(cap, "asks") ?? [];
    const decisionOf = (tool: string, index = 0) =>
      asks.filter((ask) => ask.tool === tool)[index]?.decision;
    const facts = asks.map(
      (ask) =>
        `${ask.tool.startsWith("mcp__") ? "an MCP tool" : ask.tool}: ${ask.decision}`,
    );
    const ok =
      decisionOf("mcp__example__send_message") === "deny" &&
      decisionOf("Write", 0) === "deny" &&
      decisionOf("Write", 1) === "allow" &&
      decisionOf("Bash") === "deny";
    return ok
      ? pass("denied what must be denied, allowed the one write inside the folder", facts)
      : fail("the deny list let something through or refused the allowed write", facts);
  },
};

export const CHECKS: Check[] = [
  // A2: the line for a usable Agent
  plugins,
  subscription,
  planApproval,
  focusView,
  advisor,
  openInTerminal,
  rewind,
  clear,
  atPath,
  goal,
  loop,
  // A3: shapes the build guessed
  unavailableReply,
  commandOutput,
  tasks,
  sessionState,
  midturnSend,
  modelCommand,
  denyReply,
  contextLeft,
  modeCycle,
  openInWebAnchors,
  terminalCommands,
  folderTrust,
  compaction,
  todowrite,
  uncommonKinds,
  knownKinds,
  denyList,
  // Issue #177 (research branch)
  ...HOOKS_MODE_CHECKS,
];
