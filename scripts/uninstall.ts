// `k-bench uninstall`: removes the Installed instance without the owner needing to know how
// it was installed. By default it stops the LaunchAgent and removes it, removes k-bench's own
// `tailscale serve` entry (on whichever port; every other entry stays) and deletes the app
// folder, keeping the database and the `k-bench` tmux server, so running Sessions carry on
// and a reinstall restores everything. `--purge` also deletes the data folder and the logs
// and ends the tmux server, which ends every Session. `--dry-run` prints every step and
// changes nothing. Each step says so when there is nothing for it to remove.
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { resolveConfig } from "../src/server/config.ts";
import {
  appDirIn,
  LAUNCH_AGENT_LABEL,
  launchAgentLoaded,
  launchAgentPlistPath,
  launchdDomain,
  logPath,
  pathDirs as pathDirsOf,
  reporter,
  succeeds,
} from "./command-lib.ts";
import { findExecutable, resolveTailscaleCli } from "./install-lib.ts";
import { findOwnEntries, readServeConfig, serveOffArgs } from "./tailscale-serve.ts";

export async function uninstall(argv: string[]): Promise<void> {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      purge: { type: "boolean", default: false },
    },
  });
  const dryRun = flags["dry-run"];
  const purge = flags.purge;

  // Explicit env, as in the install: never a K_BENCH_* override from the shell.
  const config = resolveConfig({ K_BENCH_INSTANCE: "installed" });
  const appDir = appDirIn(config.dataDir);
  const logDir = dirname(logPath());
  const plistPath = launchAgentPlistPath();
  const domain = launchdDomain();
  const pathDirs = pathDirsOf();

  let failed = false;
  const { say, step } = reporter(dryRun);

  say(
    dryRun
      ? "k-bench uninstall: dry run, nothing will be changed.\n"
      : "k-bench uninstall\n",
  );
  if (purge) {
    say(
      `--purge: this deletes the database (every Workspace and Session) in ${config.dataDir} ` +
        `and ends the "${config.tmuxSocket}" tmux server, which ends every Session. ` +
        "It cannot be undone.\n",
    );
  }

  // 1. The service. launchctl bootout stops the server; it leaves tmux, and so every
  // Session, running (AbandonProcessGroup, ADR-0001).
  if (launchAgentLoaded()) {
    await step(
      `stop the LaunchAgent (launchctl bootout ${domain}/${LAUNCH_AGENT_LABEL})`,
      () => {
        if (!succeeds("launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`])) {
          console.error("k-bench uninstall: launchctl could not stop the LaunchAgent.");
          process.exit(1);
        }
      },
    );
  } else {
    say("no LaunchAgent is loaded: nothing to stop");
  }
  if (existsSync(plistPath)) {
    await step(
      `delete the LaunchAgent ${plistPath} (k-bench stops starting at login)`,
      () => rmSync(plistPath, { force: true }),
    );
  } else {
    say(`no LaunchAgent file at ${plistPath}: nothing to delete`);
  }

  // 2. k-bench's own tailscale serve entry, on whichever port it is.
  const tailscale = resolveTailscaleCli({ pathDirs });
  if (!tailscale) {
    say(
      "the Tailscale CLI was not found: not looking for a tailscale serve entry. " +
        "If k-bench was published, remove it with `tailscale serve status` and `tailscale serve --https=<port> off`.",
    );
  } else {
    try {
      const serveConfig = readServeConfig(tailscale);
      // Every port k-bench is published on (a reinstall on another --https-port leaves the
      // earlier entry behind), and nothing else.
      const own = findOwnEntries(serveConfig, config.port);
      if (own.length > 0) {
        for (const entry of own) {
          const offArgs = serveOffArgs(entry);
          await step(
            `remove k-bench's tailscale serve entry on port ${entry.port}: ${tailscale} ${offArgs.join(" ")}`,
            () => {
              if (!succeeds(tailscale, offArgs)) {
                failed = true;
                console.error(
                  `k-bench uninstall: could not remove the entry on port ${entry.port}. Remove it yourself with \`tailscale serve ${offArgs.slice(1).join(" ")}\`.`,
                );
              }
            },
          );
        }
        const others = serveConfig.entries.filter((entry) => !own.includes(entry));
        if (others.length > 0) {
          say(
            `leaving ${others.length === 1 ? "the other tailscale serve entry" : `the ${others.length} other tailscale serve entries`} alone (port ${others.map((entry) => entry.port).join(", ")})`,
          );
        }
      } else {
        say(
          `no tailscale serve entry for k-bench (a proxy to ${`http://127.0.0.1:${config.port}`}): nothing to remove`,
        );
      }
    } catch (error) {
      failed = true;
      console.error(
        `k-bench uninstall: ${(error as Error).message}\nk-bench's tailscale serve entry, if any, was not removed.`,
      );
    }
  }

  // 3. The app folder (and leftovers of an interrupted install). Never the database beside it.
  const appFolders = [appDir, `${appDir}.staging`, `${appDir}.previous`].filter((dir) =>
    existsSync(dir),
  );
  if (appFolders.length > 0) {
    await step(`delete the app folder ${appFolders.join(", ")}`, () => {
      for (const dir of appFolders) rmSync(dir, { recursive: true, force: true });
    });
  } else {
    say(`no app folder at ${appDir}: nothing to delete`);
  }

  // 4. Purge: the Sessions, then the data.
  if (purge) {
    const tmux = findExecutable("tmux", pathDirs);
    const tmuxArgs = ["-L", config.tmuxSocket];
    if (tmux && succeeds(tmux, [...tmuxArgs, "list-sessions"])) {
      await step(
        `end the "${config.tmuxSocket}" tmux server: this ends every Session (tmux -L ${config.tmuxSocket} kill-server)`,
        () => {
          succeeds(tmux, [...tmuxArgs, "kill-server"]);
        },
      );
    } else {
      say(`no "${config.tmuxSocket}" tmux server is running: no Sessions to end`);
    }
    if (existsSync(config.dataDir)) {
      await step(
        `delete the data folder ${config.dataDir}, including the database: every Workspace and Session is lost`,
        () => rmSync(config.dataDir, { recursive: true, force: true }),
      );
    } else {
      say(`no data folder at ${config.dataDir}: nothing to delete`);
    }
    if (existsSync(logDir)) {
      await step(`delete the logs ${logDir}`, () =>
        rmSync(logDir, { recursive: true, force: true }),
      );
    } else {
      say(`no logs at ${logDir}: nothing to delete`);
    }
  }

  say("");
  if (purge) {
    say(
      dryRun
        ? "Dry run finished: nothing was changed. With --purge nothing of k-bench would be kept."
        : "Removed k-bench and its data. Nothing of it was kept.",
    );
    say(
      "The k-bench command itself is still installed: remove it with `npm uninstall -g @k-electron/k-bench`.",
    );
  } else {
    say(
      dryRun ? "Dry run finished: nothing was changed." : "Removed the k-bench service.",
    );
    say(dryRun ? "It would keep:" : "Kept:");
    say(
      `  ${config.dataDir}: the database, so every Workspace and Session is still listed`,
    );
    say(
      `  the "${config.tmuxSocket}" tmux server: running Sessions carry on until you end them or restart the Mac`,
    );
    say(`  ${logDir}: the logs`);
    say(
      "Run `k-bench install` to restore the service; `k-bench uninstall --purge` removes the data and ends every Session.",
    );
  }
  if (failed) process.exit(1);
}
