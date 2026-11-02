#!/usr/bin/env node
// The release workflow runs this before `npm publish`: npm trusted publishing (OIDC) needs
// npm 11.5.1 or later, and an older npm would fail the publish part way through a release.
import { execFileSync } from "node:child_process";
import { compareSemver } from "./release-lib.ts";

const MINIMUM = "11.5.1";
const version = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();

if (compareSemver(version, MINIMUM) < 0) {
  console.error(
    `npm ${version} is too old for trusted publishing: it needs ${MINIMUM} or later.`,
  );
  process.exit(1);
}
console.log(`npm ${version} supports trusted publishing (needs ${MINIMUM} or later).`);
