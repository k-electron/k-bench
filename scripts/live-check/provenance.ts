// What the live check removes from the owner's Claude Code folder when it ends, and only that:
// each thing is named by where it came from (this run's own folder, this run's own session
// IDs, a plan this run's own `ExitPlanMode` named), never by a pattern. See
// docs/internals/live-check.md.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { isInside, resolveReal } from "./rails.ts";

/** The name Claude Code gives the folder that holds a project's conversations: every character but letters and digits becomes `-`. */
export function projectDirName(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, "-");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Removal {
  path: string;
  /** In plain words, for the list the run prints. */
  why: string;
}

export interface CleanupInput {
  /** Claude Code's folder (`~/.claude`, or `CLAUDE_CONFIG_DIR`; a temp one in `--fake`). */
  configDir: string;
  /** The throwaway folder, as `realpath` gives it. */
  folder: string;
  /** Part of the folder's name that is this run's alone. */
  runId: string;
  /** When the run started (ms). */
  startedAt: number;
  /** The plan files `ExitPlanMode` named during this run (`input.planFilePath`). */
  reportedPlans: readonly string[];
  /** The conversation IDs this run saw. */
  sessionIds: readonly string[];
}

/** What to remove: the plan files, the conversation folder, and the per-conversation folders of this run's own IDs. Nothing is removed here. */
export function planCleanup(input: CleanupInput): Removal[] {
  const { configDir, folder, runId, startedAt } = input;
  const removals: Removal[] = [];
  const add = (path: string, why: string) => {
    if (!removals.some((removal) => removal.path === path)) removals.push({ path, why });
  };

  // The conversations of the throwaway folder: one folder, derived from the folder's own path.
  const projects = join(configDir, "projects");
  const name = projectDirName(folder);
  const project = join(projects, name);
  if (
    runId.length >= 4 &&
    name.includes(projectDirName(`kb-livecheck-${runId}`)) &&
    dirname(project) === projects &&
    basename(project) === name &&
    existsSync(project)
  ) {
    add(project, "the conversations saved for the throwaway folder");
  }

  // Plan files: the ones this run's ExitPlanMode named, and any new one that mentions the folder.
  const plans = join(configDir, "plans");
  const inPlans = (path: string) =>
    resolveReal(path).startsWith(`${resolveReal(plans)}${sep}`) &&
    isInside(plans, path) &&
    existsSync(path);
  for (const path of input.reportedPlans) {
    if (inPlans(path))
      add(resolveReal(path), "a plan file this run's ExitPlanMode named");
  }
  if (existsSync(plans)) {
    for (const entry of readdirSync(plans)) {
      const path = join(plans, entry);
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.birthtimeMs < startedAt - 1000) continue;
        if (readFileSync(path, "utf8").includes(folder)) {
          add(
            path,
            "a plan file made during this run that mentions the throwaway folder",
          );
        }
      } catch {
        // Gone, or not readable: not ours to remove.
      }
    }
  }

  // Per-conversation folders of the IDs this run saw (checkpoint backups, session environment).
  for (const id of input.sessionIds) {
    if (!UUID.test(id)) continue;
    for (const kind of ["file-history", "session-env"]) {
      const path = join(configDir, kind, id);
      if (existsSync(path)) add(path, `${kind} of a conversation of this run`);
    }
  }
  return removals;
}

/** Removes what `planCleanup` listed and returns what it removed. Never throws: a failure is listed as not removed. */
export function runCleanup(removals: readonly Removal[]): {
  removed: Removal[];
  failed: Removal[];
} {
  const removed: Removal[] = [];
  const failed: Removal[] = [];
  for (const removal of removals) {
    try {
      rmSync(removal.path, { recursive: true, force: true });
      (existsSync(removal.path) ? failed : removed).push(removal);
    } catch {
      failed.push(removal);
    }
  }
  return { removed, failed };
}
