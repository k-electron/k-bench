import type { RunExtras } from "./run.ts";
import type { LiveSession, Run, SessionSpec } from "./session.ts";

/** What the script says about a check. */
export type Verdict = "PASS" | "FAIL" | "NOT PROVOKED" | "NEEDS REAL CLAUDE" | "NOT RUN";

export interface Outcome {
  verdict: Verdict;
  /** In a sentence: why, and for FAIL which assumption is wrong. Labels only: it goes in results.md. */
  reason: string;
  /** Observations worth keeping, as labels. */
  facts?: string[];
}

/** What a scenario saw: its sessions, and what it noted besides. */
export interface Captured {
  sessions: LiveSession[];
  notes: Record<string, unknown>;
  /** Set when the scenario did not run to its end, and why. */
  incomplete?: { why: "budget" | "skipped" | "error" | "aborted"; detail: string };
}

export const SCENARIOS = [
  "baseline",
  "plan",
  "focus",
  "advisor",
  "terminal",
  "clear",
  "at-path",
  "goal",
  "loop",
  "tasks",
  "midturn",
  "compaction",
  "rails",
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export interface Ctx {
  run: Run;
  extras: RunExtras;
  cap: Captured;
  /** Opens a session of this scenario (it is closed by the scenario, or at the end of the run). */
  open(spec: Omit<SessionSpec, "name">): LiveSession;
}

export interface Scenario {
  name: ScenarioName;
  /** Most turns it may spend (also bounded by the run's cap). */
  budget: number;
  /** In `--fake`: why the fake cannot play it, so it is not run and its checks need the real `claude`. */
  fakeCannot?: string;
  /** With the real `claude`: why it cannot be played (it exercises the rails with the fake only). */
  realCannot?: string;
  run(ctx: Ctx): Promise<void>;
}

export interface EvalContext {
  run: Run;
  extras: RunExtras;
  cap: Captured;
  /** What every scenario captured. */
  all: ReadonlyMap<ScenarioName, Captured>;
}

export interface Check {
  name: string;
  /** Which part of issue #161: A2 (the rows of #121) or A3 (shapes the build guessed). */
  row: "A2" | "A3" | "rail";
  title: string;
  scenario: ScenarioName;
  /** In `--fake`: why the fake cannot answer this, so it reports NEEDS REAL CLAUDE. */
  fakeCannot?: string;
  /** The assumption in k-bench's code the verdict confirms or refutes: file and name. */
  assumption: string;
  evaluate(context: EvalContext): Promise<Outcome> | Outcome;
}
