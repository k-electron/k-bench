// The pure parts of the release tooling, shared by `pnpm release` (scripts/release.ts) and the
// release workflow's decision step (scripts/release-plan.ts).

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export function isValidSemver(version: string): boolean {
  return SEMVER.test(version);
}

/** Semver precedence: negative when a < b, positive when a > b. Build metadata is ignored. */
export function compareSemver(a: string, b: string): number {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) throw new Error(`Not a semver version: ${left ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const difference = Number(left[i]) - Number(right[i]);
    if (difference !== 0) return difference;
  }
  const leftPre = left[4]?.split(".");
  const rightPre = right[4]?.split(".");
  if (!leftPre || !rightPre) return leftPre ? -1 : rightPre ? 1 : 0;
  for (let i = 0; i < Math.max(leftPre.length, rightPre.length); i++) {
    const l = leftPre[i];
    const r = rightPre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) return Number(l) - Number(r);
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

const LINK_REFERENCE = /^\[[^\]]+\]: /;

function versionHeading(version: string): RegExp {
  const escaped = version.replace(/[.+-]/g, "\\$&");
  return new RegExp(`^## \\[${escaped}\\]`);
}

function sectionBounds(
  lines: string[],
  heading: RegExp,
): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("## ") || LINK_REFERENCE.test(line)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function sectionBody(lines: string[], heading: RegExp): string | undefined {
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return undefined;
  return lines
    .slice(bounds.start + 1, bounds.end)
    .join("\n")
    .trim();
}

/** The notes under `## [version]`, or undefined when the changelog has no such section. */
export function changelogSection(changelog: string, version: string): string | undefined {
  return sectionBody(changelog.split("\n"), versionHeading(version));
}

/** The notes under `## [Unreleased]`, headings with nothing under them dropped; empty if none. */
export function unreleasedNotes(changelog: string): string {
  const body = sectionBody(changelog.split("\n"), /^## \[Unreleased\]/) ?? "";
  const kept: string[] = [];
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    if (line.startsWith("### ")) {
      const next = lines.slice(i + 1).find((later) => later.trim() !== "");
      if (next === undefined || next.startsWith("### ")) return;
    }
    kept.push(line);
  });
  return kept.join("\n").trim();
}

/**
 * Moves the Unreleased notes under `## [version] - date`, leaving a fresh empty Unreleased, and
 * keeps the link references at the bottom in step. Throws when there are no notes to move.
 */
export function releaseChangelog(
  changelog: string,
  version: string,
  date: string,
): string {
  if (changelogSection(changelog, version) !== undefined)
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  const notes = unreleasedNotes(changelog);
  if (notes === "")
    throw new Error(
      "CHANGELOG.md has nothing under Unreleased, so there is nothing to release.",
    );

  const lines = changelog.split("\n");
  const bounds = sectionBounds(lines, /^## \[Unreleased\]/);
  if (!bounds) throw new Error("CHANGELOG.md has no `## [Unreleased]` section.");
  const before = lines.slice(0, bounds.start);
  const after = lines.slice(bounds.end);
  const previous = after
    .find((line) => /^## \[\d/.test(line))
    ?.match(/^## \[([^\]]+)\]/)?.[1];

  const out = [
    ...before,
    "## [Unreleased]",
    "",
    `## [${version}] - ${date}`,
    "",
    notes,
    "",
    ...after,
  ];
  return updateLinkReferences(out.join("\n"), version, previous);
}

function updateLinkReferences(
  changelog: string,
  version: string,
  previous?: string,
): string {
  const unreleased =
    /^\[Unreleased\]: (https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/.*$/m.exec(changelog);
  if (!unreleased) return changelog;
  const repo = unreleased[1];
  const versionRef = previous
    ? `[${version}]: ${repo}/compare/v${previous}...v${version}`
    : `[${version}]: ${repo}/releases/tag/v${version}`;
  return changelog.replace(
    unreleased[0],
    `[Unreleased]: ${repo}/compare/v${version}...HEAD\n${versionRef}`,
  );
}

/** Sets the top-level "version" in package.json text without disturbing its formatting. */
export function setPackageVersion(packageJson: string, version: string): string {
  const pattern = /^(\s*"version":\s*)"[^"]*"/m;
  if (!pattern.test(packageJson)) throw new Error('package.json has no "version" field.');
  return packageJson.replace(pattern, `$1"${version}"`);
}

export type NpmLookup =
  | { kind: "package-missing" }
  | { kind: "found"; versions: string[] }
  | { kind: "error"; message: string };

/** Asks an npm registry which versions of `packageName` exist. Never throws. */
export async function lookupOnNpm(
  packageName: string,
  registry = "https://registry.npmjs.org",
): Promise<NpmLookup> {
  const url = `${registry.replace(/\/$/, "")}/${packageName.replace("/", "%2f")}`;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (response.status === 404) return { kind: "package-missing" };
    if (!response.ok)
      return { kind: "error", message: `${url} answered HTTP ${response.status}` };
    const body = (await response.json()) as { versions?: Record<string, unknown> };
    return { kind: "found", versions: Object.keys(body.versions ?? {}) };
  } catch (error) {
    return {
      kind: "error",
      message: `could not reach ${url}: ${error instanceof Error ? error.message : error}`,
    };
  }
}

export type PublishDecision =
  | { publish: true; reason: string }
  | { publish: false; reason: string }
  | { error: string };

/**
 * Whether the release workflow may publish. The only way to "yes" is a real version, on a
 * package that exists on npm, that npm doesn't have yet. A missing package or version 0.0.0 is
 * a clear "no"; a lookup that fails is an error, never a guess.
 */
export function decidePublish(
  version: string,
  lookup: NpmLookup | undefined,
): PublishDecision {
  if (!isValidSemver(version))
    return { error: `package.json version "${version}" is not valid semver.` };
  if (version === "0.0.0")
    return {
      publish: false,
      reason:
        "version is 0.0.0, the placeholder that is published by hand once; the workflow never publishes it.",
    };
  if (!lookup) throw new Error("decidePublish needs an npm lookup for a real version.");
  if (lookup.kind === "error") return { error: `npm lookup failed: ${lookup.message}` };
  if (lookup.kind === "package-missing")
    return {
      publish: false,
      reason:
        "the package does not exist on npm yet (HTTP 404). Nothing is published until the owner has created it and configured trusted publishing (see docs/internals/releasing.md).",
    };
  if (lookup.versions.includes(version))
    return { publish: false, reason: `${version} is already on npm.` };
  return { publish: true, reason: `${version} is not on npm yet.` };
}
