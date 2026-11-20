// The live check's rails (docs/internals/live-check.md): the pure decisions that keep a run
// from spending more than it should or touching what it must not. No process, no SDK, no
// output here, so each decision can be tested (test/live-check-rails.test.ts).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// ---- Model -----------------------------------------------------------------------------

/**
 * Why a session's first `system/init` ends the whole run, or undefined when it is on Haiku.
 * The check is on what Claude Code reports (`init.model`), never on the option that was passed:
 * the owner's saved defaults are another model, and a query that forgot an option would run on
 * them.
 */
export function modelProblem(init: { model?: unknown }): string | undefined {
  const model = typeof init.model === "string" ? init.model : "";
  if (/haiku/i.test(model)) return undefined;
  return model === ""
    ? "a session's init names no model, so it cannot be shown to be on Haiku"
    : `a session reports the model "${model.slice(0, 80)}", not Haiku`;
}

// ---- Budget ----------------------------------------------------------------------------

export class BudgetExhausted extends Error {
  readonly scope: string;
  readonly level: "run" | "scope";

  constructor(scope: string, level: "run" | "scope") {
    super(
      level === "run"
        ? "the run's turn budget is spent"
        : `the budget of "${scope}" is spent`,
    );
    this.scope = scope;
    this.level = level;
  }
}

interface Counter {
  max: number;
  spent: number;
  inflight: number;
}

/**
 * The hard cap on model turns across the run, counted from `result` messages (and, for turns
 * typed into a terminal, which produce none, when they are sent). A turn is reserved before
 * its prompt is sent, so the cap holds even for a turn that would run long; a `result` nobody
 * reserved a turn for (what `/goal` and `/loop` start by themselves) is counted as it arrives.
 */
export class Budget {
  private readonly total: Counter;
  private readonly scopes = new Map<string, Counter>();

  constructor(cap: number) {
    this.total = { max: cap, spent: 0, inflight: 0 };
  }

  get cap(): number {
    return this.total.max;
  }

  get spent(): number {
    return this.total.spent;
  }

  /** Gives `name` its own, smaller limit. */
  scope(name: string, max: number): void {
    this.scopes.set(name, { max, spent: 0, inflight: 0 });
  }

  spentIn(name: string): number {
    return this.scopes.get(name)?.spent ?? 0;
  }

  /** True once the run's cap is reached, whatever is in flight. */
  get exhausted(): boolean {
    return this.total.spent >= this.total.max;
  }

  scopeExhausted(name: string): boolean {
    const scope = this.scopes.get(name);
    return scope !== undefined && scope.spent >= scope.max;
  }

  /** Books one turn before its prompt is sent; throws instead when it does not fit. */
  reserve(name: string): void {
    const scope = this.scopes.get(name);
    if (this.total.spent + this.total.inflight + 1 > this.total.max) {
      throw new BudgetExhausted(name, "run");
    }
    if (scope && scope.spent + scope.inflight + 1 > scope.max) {
      throw new BudgetExhausted(name, "scope");
    }
    this.total.inflight += 1;
    if (scope) scope.inflight += 1;
  }

  /** A `result` arrived in `name`'s session: the turn it ended is spent. */
  resultSeen(name: string): void {
    const scope = this.scopes.get(name);
    this.total.spent += 1;
    if (this.total.inflight > 0) this.total.inflight -= 1;
    if (scope) {
      scope.spent += 1;
      if (scope.inflight > 0) scope.inflight -= 1;
    }
  }

  /** A turn typed into a terminal: no `result` will say so, so it is spent when it is sent. */
  spendUnobserved(name: string): void {
    this.reserve(name);
    this.resultSeen(name);
  }
}

// ---- Tools -----------------------------------------------------------------------------

/** What a check lets Claude do. Everything else is denied. */
export interface ToolPolicy {
  /** The throwaway folder, as `realpath` gives it: the only place Read, Write and Edit may touch. */
  folder: string;
  /** More folders the file tools may touch (the plan check's plan file lives in Claude Code's own folder). */
  alsoFolders?: readonly string[];
  /** Tools allowed besides Read, Write and Edit inside the folder (`ExitPlanMode`, ...). Never an `mcp__` tool. */
  allow?: readonly string[];
  /** Names of the subagent tool (`Agent`, once `Task`), allowed when the check is the subagent one. */
  subagent?: readonly string[];
  /** The one Bash command allowed, exactly, in the check that needs it. */
  bash?: string;
}

export type ToolDecision = { behavior: "allow" } | { behavior: "deny"; message: string };

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);

/** The path as `realpath` gives it, for a file that may not exist yet (its nearest folder that does is resolved). */
export function resolveReal(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let at = absolute;
  while (!existsSync(at)) {
    const up = dirname(at);
    if (up === at) return absolute;
    missing.unshift(basename(at));
    at = up;
  }
  return join(realpathSync(at), ...missing);
}

/** Whether `path` is `folder` or inside it, symlinks resolved. */
export function isInside(folder: string, path: string): boolean {
  const rel = relative(resolveReal(folder), resolveReal(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The answer to a permission ask. Denied, always: any `mcp__*` tool (the owner's claude.ai
 * connectors may include mail, a calendar, a brokerage that places orders) and anything not
 * listed. Allowed: Read, Write and Edit only where the real path of `file_path` is inside the
 * throwaway folder, what the check's policy lists, the subagent tool in the subagent check, and
 * the one fixed Bash command.
 */
export function decideTool(
  policy: ToolPolicy,
  toolName: string,
  input: Record<string, unknown>,
): ToolDecision {
  const deny = (why: string): ToolDecision => ({
    behavior: "deny",
    message: `The live check does not allow ${why}.`,
  });
  if (toolName.startsWith("mcp__")) return deny("any MCP tool");
  if (FILE_TOOLS.has(toolName)) {
    const file = input.file_path;
    if (typeof file !== "string" || file === "")
      return deny(`${toolName} without a path`);
    const target = resolve(policy.folder, file);
    return [policy.folder, ...(policy.alsoFolders ?? [])].some((folder) =>
      isInside(folder, target),
    )
      ? { behavior: "allow" }
      : deny(`${toolName} outside its throwaway folder`);
  }
  if (policy.subagent?.includes(toolName)) return { behavior: "allow" };
  if (toolName === "Bash") {
    return policy.bash !== undefined && input.command === policy.bash
      ? { behavior: "allow" }
      : deny("that command");
  }
  if (policy.allow?.includes(toolName)) return { behavior: "allow" };
  return deny(toolName);
}

/**
 * Tools removed from Claude's context outright (`disallowedTools` beats every allow rule the
 * owner's settings hold, which `canUseTool` does not: a rule that allows a tool skips the ask).
 * `mcp__*` is spelled three ways because how the pattern is read is not confirmed; the other
 * layers (`strictMcpConfig`, `disableClaudeAiConnectors`, `decideTool`) do not depend on it.
 */
export function blockedTools(options: {
  /** The check needs Bash (the background-task one), which `settingsRisk` allowed. */
  bash?: boolean;
  /** The check needs the file tools gone: `@path` must be expanded by Claude Code, not read by the model. */
  noFileTools?: boolean;
  /** The denial check needs WebFetch offered, so that a deny rule (not this list) refuses it (issue #177). */
  webFetch?: boolean;
  /** Names `settingsRisk` found in the owner's allow rules, so that the same rule denies. */
  fromRules?: readonly string[];
}): string[] {
  return [
    "mcp__*",
    "mcp__*__*",
    "mcp__claude_ai_*",
    ...(options.bash ? [] : ["Bash"]),
    ...(options.webFetch ? [] : ["WebFetch"]),
    "WebSearch",
    "NotebookEdit",
    ...(options.noFileTools ? ["Read", "Glob", "Grep", "Write", "Edit"] : []),
    ...(options.fromRules ?? []),
  ];
}

// ---- The owner's settings --------------------------------------------------------------

export interface SettingsRisk {
  /** Plain categories of what was found, never the rules themselves (they may hold paths or secrets). */
  categories: string[];
  /** Allow rules that could cover an MCP tool: the same text goes to `disallowedTools`. Never printed. */
  denyToo: string[];
  /** An allow rule could cover any Bash command, so the check that needs Bash is not run. */
  bashCovered: boolean;
  /** Why the run must not start, if the settings cannot be made safe. */
  abort?: string;
}

/**
 * Reads the owner's Claude Code settings (their texts, the files being read-only here) for what
 * could let a tool run without `canUseTool` asking: allow rules for Bash or an MCP tool. Other
 * allow rules are ordinary (Read, Edit) and are not reported. A file that exists and cannot
 * be read as settings ends the run, since what it allows is not known.
 */
export function settingsRisk(
  files: ReadonlyArray<{ label: string; text: string }>,
): SettingsRisk {
  const risk: SettingsRisk = { categories: [], denyToo: [], bashCovered: false };
  const note = (category: string) => {
    if (!risk.categories.includes(category)) risk.categories.push(category);
  };
  for (const { label, text } of files) {
    let settings: unknown;
    try {
      settings = JSON.parse(text);
    } catch {
      risk.abort = `the ${label} settings file is not valid JSON, so what it allows is not known`;
      return risk;
    }
    if (typeof settings !== "object" || settings === null) continue;
    const permissions = (settings as { permissions?: unknown }).permissions;
    const allow =
      typeof permissions === "object" &&
      permissions !== null &&
      Array.isArray((permissions as { allow?: unknown }).allow)
        ? ((permissions as { allow: unknown[] }).allow.filter(
            (rule) => typeof rule === "string",
          ) as string[])
        : [];
    for (const rule of allow) {
      const trimmed = rule.trim();
      if (trimmed === "*" || trimmed === "") {
        note("a blanket allow rule");
        risk.bashCovered = true;
        risk.denyToo.push("mcp__*");
      } else if (/^Bash(\(.*\))?$/.test(trimmed)) {
        note("an allow rule for Bash");
        // `Bash` or `Bash(*)` covers any command; `Bash(git status:*)` only some.
        if (trimmed === "Bash" || /^Bash\(\s*\**\s*(:\*)?\s*\)$/.test(trimmed)) {
          risk.bashCovered = true;
        }
      } else if (trimmed.startsWith("mcp__")) {
        note("an allow rule for an MCP tool");
        risk.denyToo.push(trimmed);
      }
    }
    const mode = (permissions as { defaultMode?: unknown } | undefined)?.defaultMode;
    if (typeof mode === "string" && mode !== "default" && mode !== "plan") {
      note("a permissive default permission mode (the run passes its own)");
    }
    const hooks = (settings as { hooks?: unknown }).hooks;
    if (
      typeof hooks === "object" &&
      hooks !== null &&
      ("PermissionRequest" in hooks || "PreToolUse" in hooks)
    ) {
      note("tool hooks (they can approve a tool)");
    }
  }
  return risk;
}

// ---- Settings files stay as they were --------------------------------------------------

/** What a file holds, as a hash, or `absent`. */
export function fileFingerprint(path: string): string {
  if (!existsSync(path)) return "absent";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The labels of the files whose fingerprint changed. */
export function changedFiles(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  return Object.keys(before).filter((label) => before[label] !== after[label]);
}

// ---- Environment -----------------------------------------------------------------------

/** What a surrounding Claude Code session sets that would change `claude`'s behaviour. */
const KEPT = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]);

/**
 * The environment for a `claude` the check starts: the owner's own, without the variables of a
 * Claude Code session the script was started from (the recorder strips the same), plus what
 * the rails need. `advisorOff` is `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`, for every check but the
 * advisor row.
 */
export function claudeEnvironment(
  base: Record<string, string | undefined>,
  options: { configDir?: string; advisorOff: boolean },
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(base)) {
    // The owner's login (a token, a provider switch) is kept: the subscription check must see it.
    const kept = KEPT.has(name) || name.startsWith("CLAUDE_CODE_USE_");
    if ((name.startsWith("CLAUDE_") && !kept) || name === "CLAUDECODE") continue;
    env[name] = value;
  }
  // Only a fake run points Claude Code at a folder of its own: with the real `claude` the
  // owner's own variable (or none) reaches it, as it does the shipped runtime.
  if (options.configDir) env.CLAUDE_CONFIG_DIR = options.configDir;
  // Report when a turn starts and ends, as k-bench's runtime asks (src/agent-runtime/session.ts).
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = "1";
  // The owner's claude.ai connectors are not loaded (they are also off in `settings`).
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  if (options.advisorOff) env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = "1";
  else delete env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL;
  return env;
}
