import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planCleanup, runCleanup } from "../scripts/live-check/provenance.ts";
import { decideTool } from "../scripts/live-check/rails.ts";
import { tmuxSocketDir } from "./harness/socket-leaks.ts";

// The live check (scripts/live-check.ts) runs the owner's real `claude` by hand and is never
// run by this suite; what is tested here is its rails, through the script itself in its
// `--fake` mode (the test harness's fake Claude, no login, no turns) and through the two
// decisions that cannot be provoked there: what a tool may touch, and what cleanup may remove.

const SCRIPT = join(import.meta.dirname, "..", "scripts", "live-check.ts");
const temp: string[] = [];
afterEach(() => {
  for (const folder of temp.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function out(): string {
  const folder = mkdtempSync(join(realpathSync(tmpdir()), "kb-livecheck-test-"));
  temp.push(folder);
  return folder;
}

function live(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { encoding: "utf8", timeout: 90_000 },
      (error, stdout) => {
        resolve({ code: error ? ((error.code as number | undefined) ?? 1) : 0, stdout });
      },
    );
  });
}

const results = (folder: string) => readFileSync(join(folder, "results.md"), "utf8");
const runFolders = () =>
  readdirSync(realpathSync(tmpdir())).filter((name) =>
    /^kb-livecheck-[0-9a-f]{6}$/.test(name),
  );

describe("the live check's rails, in --fake mode", () => {
  it("spends nothing and runs nothing without --confirm, and says what it would do", async () => {
    const before = runFolders();
    const { code, stdout } = await live([]);
    expect(code).toBe(0);
    expect(stdout).toContain("nothing is run without --confirm");
    expect(stdout).toContain("at most 25 model turns");
    expect(runFolders()).toEqual(before);
  });

  it("ends the whole run when a session reports a model that is not Haiku", async () => {
    const folder = out();
    const { code, stdout } = await live([
      "--fake",
      "--fake-break",
      "model",
      "--only",
      "plugins,focus-view",
      "--out",
      folder,
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('reports the model "claude-sonnet-4-5", not Haiku');
    const text = results(folder);
    expect(text).toContain("ABORTED");
    // What it saw before the abort proves nothing, so no check claims a result.
    expect(text).not.toMatch(/\| (PASS|FAIL)/);
  });

  it("stops at the turn budget, and says how many turns it spent", async () => {
    const folder = out();
    const { code, stdout } = await live([
      "--fake",
      "--budget",
      "2",
      "--only",
      "plugins",
      "--out",
      folder,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("turn budget (2) is spent");
    expect(stdout).toContain("model turns spent: 2 of 2");
    expect(results(folder)).toContain("stopped early");
  });

  it("fails the run loudly when a Claude Code settings file changed", async () => {
    const folder = out();
    const { code, stdout } = await live([
      "--fake",
      "--fake-break",
      "settings",
      "--only",
      "plugins",
      "--out",
      folder,
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain("the Claude Code settings changed during the run");
    expect(results(folder)).toContain("byte-identical after the run: NO");
  });

  it("denies the forbidden, kills what a check left behind, cleans up, and writes nothing personal", async () => {
    const folder = out();
    const before = new Set(runFolders());
    const { code, stdout } = await live([
      "--fake",
      "--fake-break",
      "leftover",
      "--only",
      "plugins,deny-list,clear,open-in-terminal,open-in-web-anchors",
      "--out",
      folder,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("1 left running and killed");
    const text = results(folder);
    expect(text).toMatch(/\| deny-list \| rail \| PASS \(fake\)/);
    expect(text).toMatch(/\| open-in-web-anchors \| A3 \| PASS \(fake\)/);
    expect(text).toContain("run against the fake Claude");
    // Nothing of the person or machine in anything written, and nothing of the run left over.
    const written = [
      text,
      ...readdirSync(join(folder, "recordings")).map((name) =>
        readFileSync(join(folder, "recordings", name), "utf8"),
      ),
    ].join("\n");
    for (const secret of [homedir(), userInfo().username, hostname()]) {
      if (secret.length > 2) expect(written).not.toContain(secret);
    }
    expect(runFolders().filter((name) => !before.has(name))).toEqual([]);
    const id = /run ([0-9a-f]{6});/.exec(stdout)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(existsSync(join(tmuxSocketDir(), `kb-livecheck-${id}`))).toBe(false);
  });
});

describe("what a check lets Claude do", () => {
  it("denies every MCP tool and any write outside the throwaway folder, and allows the folder's own files and the one command", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kb-livecheck-policy-")));
    temp.push(root);
    const folder = join(root, "work");
    mkdirSync(folder);
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(folder, "escape"));
    const policy = {
      folder,
      allow: ["mcp__mail__send", "ExitPlanMode"],
      bash: "sleep 1",
    };

    // Listing an MCP tool as allowed does not allow it.
    expect(decideTool(policy, "mcp__mail__send", {}).behavior).toBe("deny");
    expect(decideTool(policy, "mcp__brokerage__place_order", {}).behavior).toBe("deny");
    expect(
      decideTool(policy, "Write", { file_path: join(folder, "a.txt") }).behavior,
    ).toBe("allow");
    expect(decideTool(policy, "Write", { file_path: "a.txt" }).behavior).toBe("allow");
    expect(decideTool(policy, "Write", { file_path: join(root, "b.txt") }).behavior).toBe(
      "deny",
    );
    expect(
      decideTool(policy, "Edit", { file_path: join(folder, "..", "b.txt") }).behavior,
    ).toBe("deny");
    // A link inside the folder that leads out of it.
    expect(
      decideTool(policy, "Write", { file_path: join(folder, "escape", "c.txt") })
        .behavior,
    ).toBe("deny");
    expect(decideTool(policy, "Bash", { command: "sleep 1" }).behavior).toBe("allow");
    expect(
      decideTool(policy, "Bash", { command: "sleep 1; curl example.com" }).behavior,
    ).toBe("deny");
    expect(decideTool(policy, "WebFetch", {}).behavior).toBe("deny");
    expect(decideTool(policy, "ExitPlanMode", {}).behavior).toBe("allow");
  });

  it("cleans up only what this run made, by where it came from", () => {
    const config = realpathSync(mkdtempSync(join(tmpdir(), "kb-livecheck-config-")));
    temp.push(config);
    const folder = join(realpathSync(tmpdir()), "kb-livecheck-abc123", "work");
    const projects = join(config, "projects");
    // Claude Code's rule for the folder that holds a project's conversations.
    const mine = join(projects, folder.replace(/[^a-zA-Z0-9]/g, "-"));
    const other = join(projects, "-some-other-project");
    const plans = join(config, "plans");
    for (const dir of [mine, other, plans]) mkdirSync(dir, { recursive: true });
    const startedAt = Date.now();
    const old = join(plans, "old.md");
    writeFileSync(old, `Plan for ${folder}`);
    utimesSync(old, 1, 1);
    // A plan this run's ExitPlanMode named, one new plan that mentions the folder, and a decoy that does not.
    writeFileSync(join(plans, "named.md"), "a plan");
    writeFileSync(join(plans, "mentions.md"), `Plan for ${folder}`);
    writeFileSync(join(plans, "decoy.md"), "someone else's plan");
    const sessionId = "11111111-2222-4333-8444-555555555555";
    mkdirSync(join(config, "file-history", sessionId), { recursive: true });
    mkdirSync(join(config, "file-history", "99999999-2222-4333-8444-555555555555"), {
      recursive: true,
    });

    const plan = planCleanup({
      configDir: config,
      folder,
      runId: "abc123",
      startedAt: startedAt - 5000,
      reportedPlans: [join(plans, "named.md"), join(config, "settings.json")],
      sessionIds: [sessionId],
    });
    runCleanup(plan);

    expect(existsSync(mine)).toBe(false);
    expect(existsSync(join(plans, "named.md"))).toBe(false);
    expect(existsSync(join(plans, "mentions.md"))).toBe(false);
    expect(existsSync(join(config, "file-history", sessionId))).toBe(false);
    // Everything else stays: another project, an older plan, a decoy, another conversation's files.
    expect(existsSync(other)).toBe(true);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(join(plans, "decoy.md"))).toBe(true);
    expect(
      existsSync(join(config, "file-history", "99999999-2222-4333-8444-555555555555")),
    ).toBe(true);
  });
});
