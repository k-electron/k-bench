#!/usr/bin/env node
// The release workflow's first step: works out, and prints, what a release of the package in
// the current folder would do. It changes nothing and publishes nothing; the workflow acts on
// the outputs it writes. Run it by hand to see the answer:
//   node scripts/release-plan.ts [--registry <url>] [--notes <file>] [--github-output]
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  changelogSection,
  decidePublish,
  isValidSemver,
  lookupOnNpm,
  unreleasedNotes,
} from "./release-lib.ts";

const { values } = parseArgs({
  options: {
    registry: { type: "string" },
    notes: { type: "string" },
    "github-output": { type: "boolean", default: false },
  },
});

const fail = (message: string): never => {
  console.error(`release-plan: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
const version = pkg.version;
const tag = `v${version}`;

const lookup =
  isValidSemver(version) && version !== "0.0.0"
    ? await lookupOnNpm(pkg.name, values.registry)
    : undefined;
const decision = decidePublish(version, lookup);
if ("error" in decision) fail(decision.error);
const { publish, reason } = decision as { publish: boolean; reason: string };

let notes = changelogSection(changelog, version);
let notesSource = `CHANGELOG.md, section [${version}]`;
if (!notes) {
  if (publish)
    fail(
      `CHANGELOG.md has no notes under "## [${version}]", so there would be nothing to put in the GitHub Release.`,
    );
  notes = unreleasedNotes(changelog);
  notesSource = `CHANGELOG.md, section [Unreleased] (there is no [${version}] section yet)`;
}

console.log(`Package:  ${pkg.name}`);
console.log(`Version:  ${version}`);
console.log(`Tag:      ${tag}`);
console.log(`Publish:  ${publish ? "YES" : "NO"} (${reason})`);
console.log(`Notes:    ${notesSource}`);
console.log("-----");
console.log(notes);
console.log("-----");

const prerelease = version.includes("-");
if (values.notes) writeFileSync(values.notes, `${notes}\n`);
if (values["github-output"]) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) fail("--github-output needs GITHUB_OUTPUT to be set.");
  appendFileSync(
    file as string,
    `publish=${publish}\nversion=${version}\ntag=${tag}\nnpm_tag=${prerelease ? "next" : "latest"}\nprerelease=${prerelease}\n`,
  );
}
