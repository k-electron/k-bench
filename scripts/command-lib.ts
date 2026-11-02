// What the `k-bench` commands (install, uninstall, status) share: where the Installed
// instance keeps its files, how they talk to launchd, and how they report what they do.
// Unlike `install-lib.ts`, which is pure, this reads HOME and PATH and runs programs.
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** The LaunchAgent's label, as `k-bench install` loads it. */
export const LAUNCH_AGENT_LABEL = "com.k-bench.server";

/** The file in the app folder that records what was installed (read by the server). */
export const BUILD_INFO_FILE = "build-info.json";

const LOG_FILE_UNDER_HOME = join("Library", "Logs", "k-bench", "k-bench.log");

/** The log file's place for a message to the owner: `~` stands for their home folder. */
export const LOG_HINT = `~/${LOG_FILE_UNDER_HOME}`;

/** The Installed instance's log file; the folder holding it is the logs `--purge` deletes. */
export function logPath(): string {
  return join(homedir(), LOG_FILE_UNDER_HOME);
}

export function launchAgentPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

/** The app folder inside the Installed instance's data folder. */
export function appDirIn(dataDir: string): string {
  return join(dataDir, "app");
}

/** The launchd domain of the logged-in user's GUI session. */
export function launchdDomain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

/** The directories on PATH. */
export function pathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PATH ?? "").split(delimiter).filter(Boolean);
}

/** Whether a program ran and exited 0; its output is discarded. */
export function succeeds(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

/** Whether launchd has the LaunchAgent loaded. */
export function launchAgentLoaded(): boolean {
  return succeeds("launchctl", ["print", `${launchdDomain()}/${LAUNCH_AGENT_LABEL}`]);
}

/**
 * How a command reports. `step` announces what it is about to do (prefixed `would:` in a
 * dry run) and does it unless this is a dry run.
 */
export function reporter(dryRun: boolean) {
  return {
    say(line: string): void {
      console.log(line);
    },
    async step(description: string, action: () => void | Promise<void>): Promise<void> {
      console.log(`${dryRun ? "would: " : ""}${description}`);
      if (!dryRun) await action();
    },
  };
}
