#!/usr/bin/env node
// `pnpm release <version>`: prepares a release PR. From a clean, up-to-date `main` it creates the
// branch release-<version>, bumps package.json, moves the CHANGELOG's Unreleased notes under the
// new version and today's date, commits, pushes the branch and opens the PR with `gh`.
// Merging that PR is what publishes (see docs/internals/releasing.md); this script publishes nothing.
//   pnpm release <version> [--dry-run] [--date YYYY-MM-DD]
// --dry-run runs every check, then prints what it would do and changes nothing.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  compareSemver,
  isValidSemver,
  releaseChangelog,
  setPackageVersion,
  unreleasedNotes,
} from "./release-lib.ts";

class Refusal extends Error {}

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Refusal(
      `\`${command} ${args.join(" ")}\` failed${stderr ? `: ${stderr}` : "."}`,
    );
  }
}

function prBody(version: string, notes: string): string {
  return [
    `Releases ${version}. Merging this to \`main\` runs the release workflow, which checks the build, publishes ${version} to npm, tags \`v${version}\` and creates the GitHub Release with the notes below.`,
    "",
    "## Release notes",
    "",
    notes,
  ].join("\n");
}

function prepare(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      date: { type: "string" },
    },
  });
  const version = positionals[0];
  if (!version || positionals.length > 1)
    throw new Refusal("Usage: pnpm release <version> [--dry-run]");
  if (!isValidSemver(version))
    throw new Refusal(
      `"${version}" is not a valid semver version (give it without a leading "v", for example 0.1.0).`,
    );
  const date = values.date ?? new Date().toLocaleDateString("sv-SE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Refusal(`"${date}" is not a YYYY-MM-DD date.`);

  const root = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
  const git = (...args: string[]) => run("git", args, root);

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main")
    throw new Refusal(`Releases start from main, but this is ${branch}.`);
  if (git("status", "--porcelain") !== "")
    throw new Refusal(
      "The working tree is not clean: commit or stash your changes first.",
    );
  git("fetch", "origin", "main");
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main"))
    throw new Refusal("main is not the same as origin/main: pull (or push) first.");

  const releaseBranch = `release-${version}`;
  if (git("branch", "--list", releaseBranch) !== "")
    throw new Refusal(`The branch ${releaseBranch} already exists locally.`);
  if (git("ls-remote", "--heads", "origin", releaseBranch) !== "")
    throw new Refusal(`The branch ${releaseBranch} already exists on origin.`);

  const packagePath = join(root, "package.json");
  const changelogPath = join(root, "CHANGELOG.md");
  const packageJson = readFileSync(packagePath, "utf8");
  const current = (JSON.parse(packageJson) as { version: string }).version;
  if (compareSemver(version, current) <= 0)
    throw new Refusal(`${version} is not newer than the current version, ${current}.`);

  const changelog = readFileSync(changelogPath, "utf8");
  let released: string;
  try {
    released = releaseChangelog(changelog, version, date);
  } catch (error) {
    throw new Refusal((error as Error).message);
  }
  const notes = unreleasedNotes(changelog);
  const title = `Release ${version}`;

  if (values["dry-run"]) {
    console.log(`Dry run: nothing was changed or pushed. It would:`);
    console.log(`  create the branch ${releaseBranch} from main`);
    console.log(`  set package.json version ${current} -> ${version}`);
    console.log(
      `  move the Unreleased notes under "## [${version}] - ${date}" in CHANGELOG.md`,
    );
    console.log(
      `  commit "${title}", push ${releaseBranch} and open a pull request titled "${title}"`,
    );
    console.log(`\nRelease notes:\n-----\n${notes}\n-----`);
    return;
  }

  git("switch", "--create", releaseBranch);
  writeFileSync(packagePath, setPackageVersion(packageJson, version));
  writeFileSync(changelogPath, released);
  git("add", "package.json", "CHANGELOG.md");
  git("commit", "--message", title);
  git("push", "--set-upstream", "origin", releaseBranch);
  const url = run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      releaseBranch,
      "--title",
      title,
      "--body",
      prBody(version, notes),
    ],
    root,
  );
  git("switch", "main");
  console.log(`Opened ${url}`);
  console.log(
    `Merging it publishes ${version}. Close it without merging to abandon the release.`,
  );
}

try {
  prepare(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`release: ${error.message}`);
  process.exit(1);
}
