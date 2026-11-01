import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Every test tmux socket is named after the run that created it, so the end of a run can
 * check that it left none behind without being confused by another run in parallel (an
 * agent in another worktree, say). A run is started by the Vitest and Playwright global
 * setups; the id reaches test workers through the environment.
 */
const RUN_ENV = "K_BENCH_TEST_RUN";

/** The folder tmux keeps its socket files in. */
export function tmuxSocketDir(): string {
  return join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${process.getuid?.()}`);
}

/** A fresh, throwaway tmux socket name for one test instance. */
export function testSocketName(): string {
  const run = process.env[RUN_ENV];
  const id = randomBytes(6).toString("hex");
  return run ? `kb-test-${run}-${id}` : `kb-test-${id}`;
}

/**
 * Starts a run: from here on, test sockets carry this run's id. Returns the end-of-run
 * check, which throws (failing the run) if any of this run's sockets is still there, after
 * cleaning them up so a failed run doesn't leave them behind either.
 */
export function startSocketLeakCheck(): () => void {
  const run = randomBytes(4).toString("hex");
  process.env[RUN_ENV] = run;
  return () => {
    const prefix = `kb-test-${run}-`;
    let leaked: string[] = [];
    try {
      leaked = readdirSync(tmuxSocketDir()).filter((name) => name.startsWith(prefix));
    } catch {
      // No socket folder: tmux never ran, so nothing can have leaked.
    }
    for (const name of leaked) {
      try {
        execFileSync("tmux", ["-L", name, "kill-server"], { stdio: "ignore" });
      } catch {
        // Already gone: only the file is left.
      }
      rmSync(join(tmuxSocketDir(), name), { force: true });
    }
    if (leaked.length > 0) {
      throw new Error(
        `This test run left ${leaked.length} tmux socket(s) behind (${leaked.join(", ")}). ` +
          "A test instance is not being disposed, or its disposal is not removing its socket.",
      );
    }
  };
}
