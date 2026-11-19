// results.md: the verdicts and what they say, as labels only, so that the owner can post it to
// issue #161. Never account details, paths, or what a model answered beyond a label.
import type { Check, Outcome, Verdict } from "./types.ts";

export interface CheckResult {
  check: Check;
  outcome: Outcome;
}

export interface Summary {
  fake: boolean;
  fakeBreak?: string;
  aborted?: string;
  claudeVersion?: string;
  sdkVersion: string;
  date: string;
  turns: { spent: number; cap: number };
  account?: string[];
  settingsChanged: string[];
  /** Which scenario saw which settings file change, and its key paths (never values). */
  settingsChanges: Array<{ scenario: string; file: string; paths: string }>;
  leftoverProcesses: number;
  removed: string[];
  notRemoved: string[];
  settingsNotes: string[];
  haikuEffort?: string;
}

/** How a verdict reads on a line. A fake run's are marked, so one cannot be mistaken for evidence. */
export function verdictLabel(verdict: Verdict, fake: boolean): string {
  return fake && (verdict === "PASS" || verdict === "FAIL")
    ? `${verdict} (fake)`
    : verdict;
}

export function renderResults(results: CheckResult[], summary: Summary): string {
  const lines: string[] = [];
  lines.push("# Live check results", "");
  if (summary.fake) {
    lines.push(
      "> **This was a run against the fake Claude (`--fake`).** It shows the script's wiring and rails work; it says nothing about the real `claude`. Do not post it as evidence for #161.",
      "",
    );
  }
  if (summary.aborted) lines.push(`> **ABORTED:** ${summary.aborted}`, "");
  for (const change of summary.settingsChanges) {
    lines.push(
      `> **FAIL: ${change.file} changed during ${change.scenario}**, keys: ${change.paths} (key names only, never values). Another running Claude Code may be the cause, or a per-session option of this run.`,
      "",
    );
  }
  if (summary.settingsChanged.length > 0 && summary.settingsChanges.length === 0) {
    lines.push(
      `> **FAIL: the Claude Code settings changed during the run** (${summary.settingsChanged.join(", ")}).`,
      "",
    );
  }
  lines.push(
    `- mode: ${summary.fake ? `fake Claude${summary.fakeBreak ? ` (deliberate fault: ${summary.fakeBreak})` : ""}` : "the installed claude"}`,
    `- claude version: ${summary.claudeVersion ?? "unknown"}; Agent SDK ${summary.sdkVersion}`,
    "- model: Haiku, effort low, on every query (the first init of each session was checked)",
    `- date: ${summary.date}`,
    `- model turns spent: ${summary.turns.spent} of ${summary.turns.cap}`,
  );
  if (summary.account) lines.push(`- login (labels only): ${summary.account.join("; ")}`);
  if (summary.haikuEffort) lines.push(`- ${summary.haikuEffort}`);
  for (const note of summary.settingsNotes) lines.push(`- owner's settings: ${note}`);
  lines.push(
    `- settings files byte-identical after the run: ${summary.settingsChanged.length === 0 && summary.settingsChanges.length === 0 ? "yes" : "NO"}`,
    `- claude processes left running (killed): ${summary.leftoverProcesses}`,
    `- cleaned up: ${summary.removed.length === 0 ? "nothing" : summary.removed.join("; ")}`,
  );
  if (summary.notRemoved.length > 0)
    lines.push(`- NOT removed: ${summary.notRemoved.join("; ")}`);
  lines.push("", "## Verdicts", "", "| Check | Row | Verdict |", "| --- | --- | --- |");
  for (const { check, outcome } of results) {
    lines.push(
      `| ${check.name} | ${check.row} | ${verdictLabel(outcome.verdict, summary.fake)} |`,
    );
  }
  lines.push("", "## Details", "");
  for (const { check, outcome } of results) {
    lines.push(
      `### ${check.name}: ${verdictLabel(outcome.verdict, summary.fake)}`,
      "",
      `${check.title}.`,
      "",
      `- ${outcome.reason}`,
      `- assumption in the code: ${check.assumption}`,
    );
    for (const fact of outcome.facts ?? []) lines.push(`- ${fact}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
