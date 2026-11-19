// Setting a run up and ending it: the throwaway folder, the settings fingerprints and scan,
// and, at the end (also after an abort or Ctrl-C), killing what the run started, asserting that
// nothing survives and the owner's settings are as they were, and the cleanup by provenance.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  FakeClaude,
  fakeClaudeConfigDir,
  installFakeClaude,
} from "../../test/harness/fake-claude.ts";
import { redactText } from "./privacy.ts";
import { planCleanup, type Removal, runCleanup } from "./provenance.ts";
import { Budget, changedFiles, fileFingerprint, settingsRisk } from "./rails.ts";
import { killGroup, type Run } from "./session.ts";
import { SettingsWatch } from "./settings-watch.ts";
import type { Tmux } from "./tmux.ts";

export interface RunOptions {
  fake: boolean;
  /** Where the redacted recordings and results.md go; default a new folder in the system temp folder. */
  out?: string;
  budget: number;
  /** The installed `claude` (default: the first on PATH). */
  claude?: string;
  /** `--fake` only: a way of making the fake misbehave, to show a rail catches it. */
  breakMode?: string;
}

/** The files of the owner's that must come out of the run byte for byte as they went in. */
const WATCHED = ["settings.json", "settings.local.json"] as const;

function onPath(program: string): string | undefined {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(folder, program);
    if (folder && existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface RunExtras {
  /** Hashes of the owner's settings files, from before the run. */
  fingerprints: Record<string, string>;
  breakMode?: string;
  tmux?: Tmux;
}

/** Makes the run: its folders, budget and settings scan. Writes nothing of the owner's. */
export function createRun(
  options: RunOptions,
  say: (line: string) => void,
): { run: Run; extras: RunExtras } {
  const id = randomBytes(3).toString("hex");
  const tmp = join(realpathSync(tmpdir()), `kb-livecheck-${id}`);
  mkdirSync(tmp, { recursive: false, mode: 0o700 });
  const folder = join(tmp, "work");
  mkdirSync(folder, { mode: 0o700 });
  const out = options.out
    ? join(options.out)
    : join(realpathSync(tmpdir()), `kb-livecheck-out-${id}`);
  mkdirSync(out, { recursive: true });

  let claude: string;
  let configDir: string;
  let fakeClaude: FakeClaude | undefined;
  if (options.fake) {
    const root = join(tmp, "fake");
    mkdirSync(root);
    claude = installFakeClaude(root);
    configDir = fakeClaudeConfigDir(claude);
    mkdirSync(configDir, { recursive: true });
    fakeClaude = new FakeClaude(root);
    seedFakeWorld(fakeClaude, realpathSync(configDir), options.breakMode);
  } else {
    const found = options.claude ?? onPath("claude");
    if (!found || !existsSync(found)) {
      throw new Error("no `claude` found: pass --claude <path>");
    }
    claude = found;
    configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    if (!existsSync(configDir)) throw new Error("Claude Code's folder does not exist");
  }
  configDir = realpathSync(configDir);
  // `getSessionMessages` reads the folder this names, in this process. Only a fake run sets it:
  // with the real `claude` the owner's own variable (or none) stays as it is, as for the runtime.
  if (options.fake) process.env.CLAUDE_CONFIG_DIR = configDir;

  const settingsFiles: Array<{ label: string; text: string }> = [];
  const fingerprints: Record<string, string> = {};
  for (const name of WATCHED) {
    const path = join(configDir, name);
    fingerprints[name] = fileFingerprint(path);
    if (existsSync(path))
      settingsFiles.push({ label: name, text: readFileSync(path, "utf8") });
  }
  const settings = settingsRisk(settingsFiles);
  if (settings.abort) throw new Error(settings.abort);

  const abort = new AbortController();
  const run: Run = {
    id,
    fake: options.fake,
    startedAt: Date.now(),
    out,
    tmp,
    folder,
    configDir,
    claude,
    places: { tmp, folder, configDir },
    budget: new Budget(options.budget),
    settings,
    settingsWatch: new SettingsWatch(configDir, WATCHED),
    settingsChanges: [],
    abort,
    sessions: new Set(),
    pids: new Set(),
    sessionIds: new Set(),
    reportedPlans: [],
    ...(fakeClaude ? { fakeClaude } : {}),
    say,
    fail(reason: string) {
      if (run.abort.signal.aborted) return;
      run.abortReason = reason;
      run.abortKind = "rail";
      say(`ABORT: ${reason}`);
      run.abort.abort();
    },
    stopForBudget(reason: string) {
      if (run.abort.signal.aborted) return;
      run.abortReason = reason;
      run.abortKind = "budget";
      say(`STOP: ${reason}`);
      run.abort.abort();
    },
  };
  return {
    run,
    extras: {
      fingerprints,
      ...(options.breakMode ? { breakMode: options.breakMode } : {}),
    },
  };
}

/** Whether a process exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The processes that have the throwaway folder (or the run's temp folder) as their working folder: what the run left running, found by where it worked. */
function processesIn(folder: string): number[] {
  try {
    const out = execFileSync("lsof", ["-a", "-d", "cwd", "-Fpn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    const found: number[] = [];
    let pid = 0;
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (
        line.startsWith("n") &&
        (line.slice(1) === folder || line.slice(1).startsWith(`${folder}/`))
      ) {
        if (pid !== process.pid) found.push(pid);
      }
    }
    return found;
  } catch {
    return [];
  }
}

export interface Ending {
  survivors: number;
  killedLeftovers: number;
  settingsChanged: string[];
  removed: Removal[];
  failed: Removal[];
  budgetSpent: number;
}

/**
 * Ends the run: everything it started is killed, a process that survives is found and killed
 * (and said so), the owner's settings files are compared with how they were, and what the run
 * made in Claude Code's folder is removed by where it came from. Safe to call twice.
 */
export async function endRun(
  run: Run,
  extras: RunExtras,
  say: (line: string) => void,
): Promise<Ending> {
  for (const session of [...run.sessions]) session.kill();
  extras.tmux?.kill();
  // Give the processes a moment to go.
  const deadline = Date.now() + 3000;
  while ([...run.pids].some(alive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const leftovers = new Set<number>([...run.pids].filter(alive));
  for (const pid of processesIn(run.folder)) leftovers.add(pid);
  for (const pid of leftovers) killGroup(pid);
  say(
    leftovers.size === 0
      ? "processes: none of the claude processes this run started is still running"
      : `processes: ${leftovers.size} left running and killed (a check left one behind)`,
  );

  // A change after the last scenario is looked for too; every change is named by scenario and key paths.
  run.settingsChanges.push(...run.settingsWatch.check("after the last scenario"));
  const after: Record<string, string> = {};
  for (const name of WATCHED) after[name] = fileFingerprint(join(run.configDir, name));
  const settingsChanged = changedFiles(extras.fingerprints, after);
  for (const change of run.settingsChanges) {
    say(
      `FAIL: ${change.file} changed during ${change.scenario}: ${redactText(change.paths.join(", "), run.places)}. Only key names are shown. Another running Claude Code may have rewritten it (to save a default, say), or a per-session option of this run wrote to it: compare with a backup before relying on it.`,
    );
  }
  if (settingsChanged.length > 0 && run.settingsChanges.length === 0) {
    say(
      `FAIL: the Claude Code settings changed during the run (${settingsChanged.join(", ")}), at a moment no scenario saw.`,
    );
  } else if (settingsChanged.length === 0) {
    say("settings: the Claude Code settings files are byte-identical to before the run");
  }

  const plan = planCleanup({
    configDir: run.configDir,
    folder: run.folder,
    runId: run.id,
    startedAt: run.startedAt,
    reportedPlans: run.reportedPlans,
    sessionIds: [...run.sessionIds],
  });
  const { removed, failed } = runCleanup(plan);
  const show = (path: string) => path.replace(homedir(), "~");
  for (const entry of removed) say(`removed: ${show(entry.path)} (${entry.why})`);
  for (const entry of failed) say(`NOT removed: ${show(entry.path)} (${entry.why})`);
  if (plan.length === 0) say("removed: nothing in Claude Code's folder needed removing");

  // The run's own temp folder, which holds the throwaway folder.
  if (
    run.tmp.startsWith(realpathSync(tmpdir())) &&
    run.tmp.includes(`kb-livecheck-${run.id}`)
  ) {
    rmSync(run.tmp, { recursive: true, force: true });
  }
  return {
    survivors: leftovers.size,
    killedLeftovers: leftovers.size,
    settingsChanged,
    removed,
    failed,
    budgetSpent: run.budget.spent,
  };
}

/** For a fake run: files that give the checks something to find. */
function seedFakeWorld(
  fake: FakeClaude,
  configDir: string,
  breakMode: string | undefined,
): void {
  const settings: Record<string, unknown> = {
    enabledPlugins: { "demo-plugin@example-marketplace": true },
    ...(breakMode === "risky-settings"
      ? { permissions: { allow: ["Bash(*)", "mcp__example__tool", "Read"] } }
      : {}),
  };
  writeFileSync(join(configDir, "settings.json"), JSON.stringify(settings, null, 2));
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  writeFileSync(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "demo-plugin@example-marketplace": [{ scope: "user", version: "1.0.0" }],
      },
    }),
  );
  fake.requireTrust();
  fake.configure({
    plugins: [{ name: "demo-plugin", path: "/home/you/.claude/plugins/demo-plugin" }],
    terminalSlashCommands: ["heapdump", "doctor"],
    ...(breakMode === "model"
      ? { model: "claude-sonnet-4-5" }
      : { model: "claude-haiku-4-5" }),
    ...(breakMode === "settings"
      ? { userSettingsFile: join(configDir, "settings.json") }
      : {}),
  });
}
