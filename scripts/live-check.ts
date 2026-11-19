// `pnpm live-check`: the live check of issue #161, part A. Read docs/internals/live-check.md.
//
// It runs the owner's installed `claude` through the Agent SDK, on Haiku, in a throwaway
// folder, and says for each line of the issue whether what k-bench's Claude Agent assumes
// about Claude Code holds. By hand only: it is not reachable from `pnpm check`, `pnpm test`,
// `pnpm test:e2e` or CI, it refuses to do anything real without `--confirm`, and `--fake` runs
// the same script against the test harness's fake Claude, which spends nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKS } from "./live-check/checks.ts";
import { HELP, parseOptions } from "./live-check/options.ts";
import { redactText, writeChecked } from "./live-check/privacy.ts";
import { BudgetExhausted } from "./live-check/rails.ts";
import {
  type CheckResult,
  renderResults,
  type Summary,
  verdictLabel,
} from "./live-check/results.ts";
import { createRun, endRun, type RunExtras } from "./live-check/run.ts";
import { SCENARIO_LIST } from "./live-check/scenarios.ts";
import { LiveSession, type Run, RunAborted } from "./live-check/session.ts";
import {
  type Captured,
  type Check,
  type Ctx,
  type Outcome,
  SCENARIOS,
  type Verdict,
} from "./live-check/types.ts";

const say = (line: string) => process.stdout.write(`${line}\n`);

let options: ReturnType<typeof parseOptions>;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n\n${HELP}\n`,
  );
  process.exit(2);
}
if (options.help) {
  say(HELP);
  process.exit(0);
}

// ---- What would run ----------------------------------------------------------------------

const unknown = options.only.filter(
  (name) => !CHECKS.some((check) => check.name === name),
);
if (unknown.length > 0) {
  process.stderr.write(
    `unknown check(s): ${unknown.join(", ")}\nchecks: ${CHECKS.map((c) => c.name).join(", ")}\n`,
  );
  process.exit(2);
}
const selected: Check[] =
  options.only.length === 0
    ? CHECKS
    : CHECKS.filter((check) => options.only.includes(check.name));
const scenarios = SCENARIO_LIST.filter((scenario) =>
  selected.some((check) => check.scenario === scenario.name),
).sort((a, b) => SCENARIOS.indexOf(a.name) - SCENARIOS.indexOf(b.name));

if (!options.fake && !options.confirm) {
  say("live check: nothing is run without --confirm. This is what it would do.");
  say("");
  say(
    "  against   : the installed `claude`, through the Agent SDK, in a throwaway folder in the system temp folder",
  );
  say(
    "  model     : Haiku, effort low, on every query; the run aborts if a session's init reports another model",
  );
  say(
    `  budget    : at most ${options.budget} model turns (--budget), stopped the moment it is spent`,
  );
  say(
    "  tools     : every mcp__* tool denied; file tools only inside the throwaway folder; the advisor off except in its own check",
  );
  say(
    "  settings  : the Claude Code settings files are hashed before and after, and the run FAILS if either changed",
  );
  say(
    "  cleanup   : only what this run made in Claude Code's folder, found by where it came from",
  );
  say("");
  say("  scenarios (in this order), with the most turns each may spend:");
  for (const scenario of scenarios) {
    const note = scenario.realCannot ? " (fake only)" : "";
    say(`    ${scenario.name.padEnd(11)} ${String(scenario.budget).padStart(2)}${note}`);
  }
  say("");
  say("  checks:");
  for (const check of selected)
    say(`    ${check.name.padEnd(20)} ${check.row.padEnd(5)} ${check.title}`);
  say("");
  say(
    "Pass --confirm to run it for real (it spends the owner's subscription turns), or --fake to rehearse it against the fake Claude for free.",
  );
  process.exit(0);
}

// ---- The run -----------------------------------------------------------------------------

const sdkVersion = (() => {
  try {
    const file = join(
      import.meta.dirname,
      "..",
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "package.json",
    );
    return String(
      (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ??
        "unknown",
    );
  } catch {
    return "unknown";
  }
})();

let made: { run: Run; extras: RunExtras };
try {
  made = createRun(
    {
      fake: options.fake,
      budget: options.budget,
      ...(options.out ? { out: options.out } : {}),
      ...(options.claude ? { claude: options.claude } : {}),
      ...(options.fakeBreak ? { breakMode: options.fakeBreak } : {}),
    },
    say,
  );
} catch (error) {
  process.stderr.write(
    `live check: not started: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
const { run, extras } = made;

say(
  `live check ${run.fake ? "(FAKE: nothing real is run, nothing is spent)" : "(REAL: spends the owner's subscription turns)"}`,
);
say(
  `  run ${run.id}; throwaway folder under the system temp folder; budget ${run.budget.cap} model turns`,
);
say(`  results and redacted recordings go to ${run.out}`);
if (run.settings.categories.length > 0) {
  say(
    `  the owner's settings hold: ${run.settings.categories.join("; ")}. Their rules are never printed. ${run.settings.bashCovered ? "Bash is not used (an allow rule could cover it)." : "Matching tools are also denied outright."}`,
  );
}

let ended = false;
let ending: Awaited<ReturnType<typeof endRun>> | undefined;
async function finish(): Promise<void> {
  if (ended) return;
  ended = true;
  ending = await endRun(run, extras, say);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    run.fail(`interrupted (${signal})`);
    // A second signal ends the cleanup in progress: what is left is killed by process group below.
    setTimeout(() => process.exit(130), 20_000).unref();
  });
}
process.on("uncaughtException", async (error) => {
  say(
    `FAIL: the script itself failed: ${redactText(String(error?.message ?? error), run.places).slice(0, 200)}`,
  );
  run.fail("the script failed");
  await finish();
  process.exit(1);
});
process.on("unhandledRejection", async (error) => {
  say(
    `FAIL: the script itself failed: ${redactText(String((error as Error)?.message ?? error), run.places).slice(0, 200)}`,
  );
  run.fail("the script failed");
  await finish();
  process.exit(1);
});

// ---- Scenarios ---------------------------------------------------------------------------

const captured = new Map<(typeof SCENARIOS)[number], Captured>();

async function play(scenario: (typeof SCENARIO_LIST)[number]): Promise<void> {
  const cap: Captured = { sessions: [], notes: {} };
  captured.set(scenario.name, cap);
  run.budget.scope(scenario.name, scenario.budget);
  const ctx: Ctx = {
    run,
    extras,
    cap,
    open(spec) {
      const session = new LiveSession(run, { ...spec, name: scenario.name });
      cap.sessions.push(session);
      return session;
    },
  };
  say(`scenario ${scenario.name} ...`);
  try {
    await scenario.run(ctx);
  } catch (error) {
    if (error instanceof BudgetExhausted) {
      cap.incomplete = { why: "budget", detail: error.message };
    } else if (error instanceof RunAborted || run.abort.signal.aborted) {
      cap.incomplete = { why: "aborted", detail: run.abortReason ?? "aborted" };
    } else {
      cap.incomplete = {
        why: "error",
        detail: redactText(
          error instanceof Error ? error.message : String(error),
          run.places,
        ).slice(0, 200),
      };
    }
    say(`  stopped: ${cap.incomplete.why}: ${cap.incomplete.detail}`);
  } finally {
    for (const session of cap.sessions) await session.close();
  }
  say(`  turns spent so far: ${run.budget.spent} of ${run.budget.cap}`);
}

// Judged before the folders go: some checks read them.
for (const scenario of scenarios) {
  if (run.abort.signal.aborted) break;
  if (run.fake && scenario.fakeCannot) continue;
  if (!run.fake && scenario.realCannot) continue;
  if (run.budget.exhausted) break;
  await play(scenario);
}

// ---- Verdicts ----------------------------------------------------------------------------

const results: CheckResult[] = [];
async function judge(check: Check): Promise<Outcome> {
  const scenario = SCENARIO_LIST.find((s) => s.name === check.scenario);
  if (run.fake && (check.fakeCannot || scenario?.fakeCannot)) {
    return {
      verdict: "NEEDS REAL CLAUDE",
      reason: check.fakeCannot ?? scenario?.fakeCannot ?? "",
    };
  }
  if (!run.fake && scenario?.realCannot)
    return { verdict: "NOT PROVOKED", reason: scenario.realCannot };
  const cap = captured.get(check.scenario);
  // A run aborted for a broken rail proves nothing about what it saw before it stopped; one
  // that only ran out of turns still has what finished.
  if (run.abort.signal.aborted && run.abortKind !== "budget") {
    return {
      verdict: "NOT RUN",
      reason: `the run was aborted: ${run.abortReason ?? "aborted"}`,
    };
  }
  if (cap?.incomplete && run.abortKind === "budget") {
    return {
      verdict: "NOT RUN",
      reason: `the turn budget ran out during its scenario (spent ${run.budget.spent} of ${run.budget.cap})`,
    };
  }
  if (!cap) {
    return {
      verdict: "NOT RUN",
      reason: `its turn budget did not fit (spent ${run.budget.spent} of ${run.budget.cap}); raise --budget or use --only`,
    };
  }
  try {
    const outcome = await check.evaluate({ run, extras, cap, all: captured });
    if (cap.incomplete && outcome.verdict === "NOT PROVOKED") {
      return {
        ...outcome,
        reason: `${outcome.reason} (the scenario stopped early: ${cap.incomplete.why})`,
      };
    }
    return outcome;
  } catch (error) {
    return {
      verdict: "NOT PROVOKED",
      reason: `the check itself failed (a script fault, not a result): ${redactText(error instanceof Error ? error.message : String(error), run.places).slice(0, 160)}`,
    };
  }
}

for (const check of selected) {
  const outcome = await judge(check);
  results.push({ check, outcome });
  say(
    `${verdictLabel(outcome.verdict, run.fake).padEnd(20)} ${check.name}: ${outcome.reason}`,
  );
}

// ---- The end -----------------------------------------------------------------------------

const firstInit = [...captured.values()]
  .flatMap((cap) => cap.sessions)
  .find((s) => s.init)?.init;
const account = captured.get("baseline")?.notes.account as
  | Record<string, unknown>
  | undefined;
const keySource = account?.apiKeySource;
const models = (
  captured.get("baseline")?.notes.initReply as { models?: unknown } | undefined
)?.models;
const haiku = Array.isArray(models)
  ? (models as Array<Record<string, unknown>>).find((m) =>
      /haiku/i.test(String(m.value ?? m.resolvedModel ?? "")),
    )
  : undefined;

await finish();

const summary: Summary = {
  fake: run.fake,
  ...(options.fakeBreak ? { fakeBreak: options.fakeBreak } : {}),
  ...(run.abortReason
    ? {
        aborted: `${run.abortKind === "budget" ? "stopped early, " : ""}${run.abortReason}`,
      }
    : {}),
  ...(typeof firstInit?.claude_code_version === "string"
    ? { claudeVersion: firstInit.claude_code_version }
    : {}),
  sdkVersion,
  date: new Date().toISOString().slice(0, 10),
  turns: { spent: run.budget.spent, cap: run.budget.cap },
  ...(account
    ? {
        account: [
          `provider ${typeof account.apiProvider === "string" ? account.apiProvider : "absent"}`,
          `key source ${keySource === undefined ? "absent" : keySource === "none" || keySource === "oauth" ? String(keySource) : "an API key"}`,
          `subscription type present: ${account.subscriptionType ? "yes" : "no"}`,
        ],
      }
    : {}),
  settingsChanged: ending?.settingsChanged ?? [],
  leftoverProcesses: ending?.survivors ?? 0,
  removed: (ending?.removed ?? []).map((entry) => entry.why),
  notRemoved: (ending?.failed ?? []).map((entry) => entry.why),
  settingsNotes: run.settings.categories,
  ...(haiku
    ? {
        haikuEffort: `the model list says Haiku supports effort levels: ${haiku.supportsEffort === true ? "yes" : haiku.supportsEffort === false ? "no (the effort option is passed anyway, as required; unverified whether it is ignored)" : "not stated"}`,
      }
    : {}),
};

// Recordings first (each is guarded), then results.md, which is guarded too.
const written: string[] = [];
for (const [name, cap] of captured) {
  const lines: string[] = [];
  cap.sessions.forEach((session, index) => {
    lines.push(
      JSON.stringify({
        session: index + 1,
        model_reported: session.init?.model ? "haiku" : "none",
      }),
    );
    lines.push(...session.recording());
  });
  if (lines.length === 0) continue;
  try {
    writeChecked(
      join(run.out, "recordings", `${name}.jsonl`),
      `${lines.join("\n")}\n`,
      `the ${name} recording`,
    );
    written.push(name);
  } catch (error) {
    say(`NOT WRITTEN: ${error instanceof Error ? error.message : String(error)}`);
  }
}
try {
  writeChecked(
    join(run.out, "results.md"),
    renderResults(results, summary),
    "results.md",
  );
  say(
    `results: ${join(run.out, "results.md")} (${written.length} recording(s) in ${join(run.out, "recordings")})`,
  );
} catch (error) {
  say(`NOT WRITTEN: ${error instanceof Error ? error.message : String(error)}`);
}

const counts = new Map<Verdict, number>();
for (const { outcome } of results)
  counts.set(outcome.verdict, (counts.get(outcome.verdict) ?? 0) + 1);
say("");
say(
  `model turns spent: ${run.budget.spent} of ${run.budget.cap}${run.fake ? " (fake)" : ""}`,
);
say(`verdicts: ${[...counts].map(([verdict, n]) => `${n} ${verdict}`).join(", ")}`);
const failed =
  (counts.get("FAIL") ?? 0) > 0 ||
  (ending?.settingsChanged.length ?? 0) > 0 ||
  run.abortKind === "rail";
say(failed ? "RESULT: FAILED (see above)" : "RESULT: no check failed");
process.exit(failed ? 1 : 0);
