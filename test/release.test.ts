// The release tooling, run as processes the way a maintainer and the release workflow run it:
// `pnpm release` against real throwaway git repos (a bare "origin" on disk, a stub `gh`), and
// the workflow's decision step against a stub npm registry.
import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "..");
const RELEASE = join(REPO_ROOT, "scripts/release.ts");
const PLAN = join(REPO_ROOT, "scripts/release-plan.ts");

const temporaryFolders: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const dir of temporaryFolders.splice(0))
    rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-release-"));
  temporaryFolders.push(dir);
  return dir;
}

const PACKAGE_JSON = (version: string) =>
  `{\n  "name": "@example/thing",\n  "version": "${version}",\n  "type": "module"\n}\n`;

const NOTES = `### Added

- Workspaces and Sessions.
- Bells.`;

const CHANGELOG = (unreleased: string, released = "") => `# Changelog

## [Unreleased]

${unreleased}
${released}
[Unreleased]: https://github.com/example/thing/commits/main
`;

async function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

describe("pnpm release", () => {
  const identity = {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  /** A work clone on main with a bare origin on disk, and a stub `gh` that records its arguments. */
  function makeRepo(options: { version?: string; changelog?: string } = {}) {
    const base = tempDir();
    const origin = join(base, "origin.git");
    const work = join(base, "work");
    const bin = join(base, "bin");
    const ghCalls = join(base, "gh-calls.txt");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg" >> "${ghCalls}"; done\necho https://github.com/example/thing/pull/1\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    const env = { ...identity, PATH: `${bin}:${process.env.PATH}` };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

    git(base, "init", "--bare", "--initial-branch=main", origin);
    git(base, "clone", origin, work);
    git(work, "switch", "--create", "main");
    writeFileSync(join(work, "package.json"), PACKAGE_JSON(options.version ?? "0.0.0"));
    writeFileSync(join(work, "CHANGELOG.md"), options.changelog ?? CHANGELOG(NOTES));
    git(work, "add", ".");
    git(work, "commit", "--message", "Start");
    git(work, "push", "--set-upstream", "origin", "main");
    return {
      work,
      origin,
      env,
      ghCalls,
      git: (...args: string[]) => git(work, ...args),
      gitIn: git,
      release: (...args: string[]) =>
        exec("node", [RELEASE, ...args], { cwd: work, env }),
    };
  }

  it("opens a PR whose branch carries the bump and the moved changelog notes", async () => {
    const repo = makeRepo();

    const result = await repo.release("0.1.0", "--date", "2026-01-02");
    expect(result.code, result.stderr).toBe(0);

    // The pushed branch is what the PR would merge: clone it from origin to look.
    const checkout = join(tempDir(), "branch");
    repo.gitIn(tempDir(), "clone", "--branch", "release-0.1.0", repo.origin, checkout);
    expect(JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")).version).toBe(
      "0.1.0",
    );
    const changelog = readFileSync(join(checkout, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(
      /## \[Unreleased\]\n\n## \[0\.1\.0\] - 2026-01-02\n\n### Added/,
    );
    expect(changelog).toContain(
      "[0.1.0]: https://github.com/example/thing/releases/tag/v0.1.0",
    );
    expect(changelog).toContain("compare/v0.1.0...HEAD");

    // The release workflow can read those notes back out of the merged changelog.
    const registry = await startRegistry({
      "/@example%2fthing": { versions: { "0.0.0": {} } },
    });
    const outputFile = join(tempDir(), "output");
    writeFileSync(outputFile, "");
    const plan = await exec("node", [PLAN, "--registry", registry, "--github-output"], {
      cwd: checkout,
      env: { GITHUB_OUTPUT: outputFile },
    });
    expect(plan.code, plan.stderr).toBe(0);
    expect(plan.stdout).toContain("- Workspaces and Sessions.");
    expect(readFileSync(outputFile, "utf8")).toContain("publish=true");

    const gh = readFileSync(repo.ghCalls, "utf8").split("\n");
    expect(gh).toContain("create");
    expect(gh).toContain("Release 0.1.0");
    expect(gh.join("\n")).toContain("- Bells.");

    // The maintainer is left on an untouched main.
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("refuses, changing nothing, when the repo or the version is not ready", async () => {
    const cases: {
      name: string;
      version: string;
      setup?: (r: ReturnType<typeof makeRepo>) => void;
      changelog?: string;
      expected: RegExp;
    }[] = [
      { name: "not semver", version: "v1", expected: /not a valid semver/ },
      { name: "not newer", version: "0.0.0", expected: /not newer/ },
      {
        name: "nothing unreleased",
        version: "0.1.0",
        changelog: CHANGELOG("### Added\n"),
        expected: /nothing under Unreleased/,
      },
      {
        name: "dirty tree",
        version: "0.1.0",
        setup: (r) => writeFileSync(join(r.work, "stray.txt"), "x"),
        expected: /not clean/,
      },
      {
        name: "not on main",
        version: "0.1.0",
        setup: (r) => r.git("switch", "--create", "feature"),
        expected: /start from main/,
      },
      {
        name: "behind origin",
        version: "0.1.0",
        setup: (r) => {
          const other = join(tempDir(), "other");
          r.gitIn(tempDir(), "clone", r.origin, other);
          writeFileSync(join(other, "later.txt"), "x");
          r.gitIn(other, "add", ".");
          r.gitIn(other, "commit", "--message", "Later");
          r.gitIn(other, "push", "origin", "HEAD:main");
        },
        expected: /not the same as origin\/main/,
      },
    ];
    for (const c of cases) {
      const repo = makeRepo({ changelog: c.changelog });
      c.setup?.(repo);
      const before = repo.git("status", "--porcelain");

      const result = await repo.release(c.version);

      expect(result.code, c.name).not.toBe(0);
      expect(result.stderr, c.name).toMatch(c.expected);
      expect(repo.git("branch", "--list", "release-*"), c.name).toBe("");
      expect(repo.git("ls-remote", "--heads", "origin", "release-*"), c.name).toBe("");
      expect(repo.git("status", "--porcelain"), c.name).toBe(before);
    }
  });

  it("--dry-run shows the release notes and changes nothing", async () => {
    const repo = makeRepo();

    const result = await repo.release("0.2.0", "--dry-run");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("- Bells.");
    expect(repo.git("branch", "--list", "release-*")).toBe("");
    expect(repo.git("ls-remote", "--heads", "origin", "release-*")).toBe("");
    expect(repo.git("status", "--porcelain")).toBe("");
  });
});

/** A stub npm registry answering the given paths with JSON (404 otherwise); returns its URL. */
async function startRegistry(
  routes: Record<string, unknown>,
  requests: string[] = [],
): Promise<string> {
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    const body = routes[request.url ?? ""];
    if (body === undefined) {
      response.writeHead(404).end("{}");
    } else if (typeof body === "number") {
      response.writeHead(body).end("{}");
    } else {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(body));
    }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

describe("the release workflow's decision step", () => {
  /** Runs the step in a folder holding the given package version and changelog. */
  async function plan(options: {
    version: string;
    routes?: Record<string, unknown>;
    changelog?: string;
  }) {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), PACKAGE_JSON(options.version));
    writeFileSync(
      join(dir, "CHANGELOG.md"),
      options.changelog ??
        CHANGELOG(
          NOTES,
          `\n## [0.1.0] - 2026-01-02\n\n### Added\n\n- The first release.\n`,
        ),
    );
    const requests: string[] = [];
    const registry = await startRegistry(options.routes ?? {}, requests);
    const outputFile = join(dir, "github-output");
    writeFileSync(outputFile, "");
    const result = await exec(
      "node",
      [PLAN, "--registry", registry, "--notes", join(dir, "notes.md"), "--github-output"],
      { cwd: dir, env: { GITHUB_OUTPUT: outputFile } },
    );
    const outputs = Object.fromEntries(
      readFileSync(outputFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=") as [string, string]),
    );
    return { ...result, outputs, requests, notesFile: join(dir, "notes.md") };
  }

  it("publishes only a real version that is missing from a package that exists on npm", async () => {
    const onNpm = { "/@example%2fthing": { versions: { "0.0.0": {}, "0.1.0": {} } } };

    const missingVersion = await plan({
      version: "0.2.0",
      routes: onNpm,
      changelog: CHANGELOG(NOTES, "\n## [0.2.0] - 2026-02-03\n\n- Second.\n"),
    });
    expect(missingVersion.code, missingVersion.stderr).toBe(0);
    expect(missingVersion.outputs).toMatchObject({
      publish: "true",
      version: "0.2.0",
      tag: "v0.2.0",
    });
    expect(readFileSync(missingVersion.notesFile, "utf8")).toBe("- Second.\n");
    expect(missingVersion.stdout).toContain("v0.2.0");

    const alreadyThere = await plan({ version: "0.1.0", routes: onNpm });
    expect(alreadyThere.code, alreadyThere.stderr).toBe(0);
    expect(alreadyThere.outputs.publish).toBe("false");
    expect(alreadyThere.stdout).toContain("already on npm");
  });

  it("does not publish while the package is missing from npm, or at 0.0.0", async () => {
    const noPackage = await plan({ version: "0.1.0", routes: {} });
    expect(noPackage.code, noPackage.stderr).toBe(0);
    expect(noPackage.outputs.publish).toBe("false");
    expect(noPackage.stdout).toContain("does not exist on npm yet");

    const placeholder = await plan({
      version: "0.0.0",
      routes: { "/@example%2fthing": { versions: {} } },
    });
    expect(placeholder.code, placeholder.stderr).toBe(0);
    expect(placeholder.outputs.publish).toBe("false");
    expect(placeholder.requests).toEqual([]);
    // A dry run on an unreleased version still shows the notes it has.
    expect(placeholder.stdout).toContain("- Bells.");
  });

  it("fails, rather than guessing, when npm cannot be asked or the notes are missing", async () => {
    const registryDown = await plan({
      version: "0.1.0",
      routes: { "/@example%2fthing": 503 },
    });
    expect(registryDown.code).not.toBe(0);
    expect(registryDown.outputs.publish).toBeUndefined();

    const noNotes = await plan({
      version: "0.3.0",
      routes: { "/@example%2fthing": { versions: { "0.1.0": {} } } },
    });
    expect(noNotes.code).not.toBe(0);
    expect(noNotes.stderr).toContain("nothing to put in the GitHub Release");
  });
});
