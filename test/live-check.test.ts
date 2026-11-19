import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNothingPrivate,
  PrivacyError,
  redactText,
} from "../scripts/live-check/privacy.ts";
import { planCleanup, runCleanup } from "../scripts/live-check/provenance.ts";
import {
  Budget,
  BudgetExhausted,
  changedFiles,
  decideTool,
  fileFingerprint,
  modelProblem,
  settingsRisk,
} from "../scripts/live-check/rails.ts";

// The rails of the live check (scripts/live-check.ts, docs/internals/live-check.md), which runs
// the owner's real `claude` by hand and is never run by this suite. The script is exercised
// against the fake Claude with `pnpm live-check --fake` (and `--fake-break`); what is tested
// here are the decisions that keep a real run safe, which the fake cannot provoke.

const temp: string[] = [];
afterEach(() => {
  for (const folder of temp.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(prefix: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temp.push(path);
  return path;
}

describe("the live check's rails", () => {
  it("aborts on a session that is not on Haiku, and stops sending at the turn cap", () => {
    expect(modelProblem({ model: "claude-haiku-4-5-20251001" })).toBeUndefined();
    expect(modelProblem({ model: "claude-sonnet-4-5" })).toContain("not Haiku");
    expect(modelProblem({ model: "claude-opus-4-1" })).toContain("not Haiku");
    // Nothing reported is as bad as another model: it cannot be shown to be Haiku.
    expect(modelProblem({})).toBeDefined();

    const budget = new Budget(3);
    budget.scope("plan", 2);
    budget.reserve("plan");
    budget.reserve("plan");
    // The scenario's own limit, with the run's cap still open.
    expect(() => budget.reserve("plan")).toThrow(BudgetExhausted);
    budget.reserve("other");
    // A turn that fits the run's cap is refused once the cap is counted, in flight or spent.
    expect(() => budget.reserve("other")).toThrow(BudgetExhausted);
    // Results nobody reserved (what /goal and /loop start by themselves) are counted as they come.
    budget.resultSeen("plan");
    budget.resultSeen("plan");
    budget.resultSeen("other");
    budget.resultSeen("loop");
    expect(budget.spent).toBe(4);
    expect(budget.exhausted).toBe(true);
  });

  it("denies every MCP tool and any write outside the throwaway folder, and allows only the folder's own files and the one command", () => {
    const root = folder("kb-livecheck-policy-");
    const work = join(root, "work");
    const plans = join(root, "plans");
    const outside = join(root, "outside");
    for (const dir of [work, plans, outside]) mkdirSync(dir);
    symlinkSync(outside, join(work, "escape"));
    const policy = {
      folder: work,
      allow: ["mcp__mail__send", "ExitPlanMode"],
      bash: "sleep 1",
    };
    const behavior = (tool: string, input: Record<string, unknown>, p = policy) =>
      decideTool(p, tool, input).behavior;

    // Listing an MCP tool as allowed does not allow it.
    expect(behavior("mcp__mail__send", {})).toBe("deny");
    expect(behavior("mcp__brokerage__place_order", {})).toBe("deny");
    expect(behavior("Write", { file_path: join(work, "a.txt") })).toBe("allow");
    expect(behavior("Write", { file_path: "a.txt" })).toBe("allow");
    expect(behavior("Write", { file_path: join(root, "b.txt") })).toBe("deny");
    expect(behavior("Edit", { file_path: join(work, "..", "b.txt") })).toBe("deny");
    // A link inside the folder that leads out of it.
    expect(behavior("Write", { file_path: join(work, "escape", "c.txt") })).toBe("deny");
    // The plan check may also write its plan file, and only there.
    const planning = { ...policy, alsoFolders: [plans] };
    expect(behavior("Write", { file_path: join(plans, "p.md") }, planning)).toBe("allow");
    expect(behavior("Write", { file_path: join(outside, "p.md") }, planning)).toBe(
      "deny",
    );
    expect(behavior("Bash", { command: "sleep 1" })).toBe("allow");
    expect(behavior("Bash", { command: "sleep 1; curl example.com" })).toBe("deny");
    expect(behavior("WebFetch", {})).toBe("deny");
    expect(behavior("ExitPlanMode", {})).toBe("allow");
  });

  it("reports what the owner's settings allow by category only, never the rule", () => {
    const risk = settingsRisk([
      {
        label: "settings.json",
        text: JSON.stringify({
          permissions: {
            allow: [
              "Bash(*)",
              "mcp__brokerage__place_order",
              "Read(/Users/someone/secret-project/**)",
            ],
          },
        }),
      },
    ]);
    expect(risk.bashCovered).toBe(true);
    expect(risk.denyToo).toEqual(["mcp__brokerage__place_order"]);
    expect(risk.categories.join(" ")).not.toMatch(/brokerage|secret-project|someone/);
    expect(risk.categories.length).toBe(2);
    // Settings that cannot be read as settings end the run: what they allow is not known.
    expect(
      settingsRisk([{ label: "settings.json", text: "{ not json" }]).abort,
    ).toBeDefined();
  });

  it("sees a settings file change, and cleans up only what this run made, by where it came from", () => {
    const config = folder("kb-livecheck-config-");
    const settings = join(config, "settings.json");
    writeFileSync(settings, '{"advisorModel":"x"}');
    const before = {
      "settings.json": fileFingerprint(settings),
      "settings.local.json": fileFingerprint(join(config, "settings.local.json")),
    };
    expect(changedFiles(before, { ...before })).toEqual([]);
    writeFileSync(settings, '{"advisorModel":"opus"}');
    expect(
      changedFiles(before, {
        "settings.json": fileFingerprint(settings),
        "settings.local.json": fileFingerprint(join(config, "settings.local.json")),
      }),
    ).toEqual(["settings.json"]);

    const work = join(realpathSync(tmpdir()), "kb-livecheck-abc123", "work");
    const projects = join(config, "projects");
    // Claude Code's rule for the folder that holds a project's conversations.
    const mine = join(projects, work.replace(/[^a-zA-Z0-9]/g, "-"));
    const other = join(projects, "-some-other-project");
    const plans = join(config, "plans");
    for (const dir of [mine, other, plans]) mkdirSync(dir, { recursive: true });
    const old = join(plans, "old.md");
    writeFileSync(old, `Plan for ${work}`);
    utimesSync(old, 1, 1);
    // A plan this run's ExitPlanMode named, a new one that mentions the folder, and a decoy.
    writeFileSync(join(plans, "named.md"), "a plan");
    writeFileSync(join(plans, "mentions.md"), `Plan for ${work}`);
    writeFileSync(join(plans, "decoy.md"), "someone else's plan");
    const ours = "11111111-2222-4333-8444-555555555555";
    const theirs = "99999999-2222-4333-8444-555555555555";
    for (const id of [ours, theirs])
      mkdirSync(join(config, "file-history", id), { recursive: true });

    runCleanup(
      planCleanup({
        configDir: config,
        folder: work,
        runId: "abc123",
        startedAt: Date.now() - 5000,
        // The second is not a plan file at all, and must stay.
        reportedPlans: [join(plans, "named.md"), settings],
        sessionIds: [ours],
      }),
    );

    expect(existsSync(mine)).toBe(false);
    expect(existsSync(join(plans, "named.md"))).toBe(false);
    expect(existsSync(join(plans, "mentions.md"))).toBe(false);
    expect(existsSync(join(config, "file-history", ours))).toBe(false);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(join(plans, "decoy.md"))).toBe(true);
    expect(existsSync(settings)).toBe(true);
    expect(existsSync(join(config, "file-history", theirs))).toBe(true);
  });

  it("refuses to write a recording that still names the person or the machine", () => {
    const places = {
      tmp: "/tmp/kb-livecheck-abc123",
      folder: "/tmp/kb-livecheck-abc123/work",
      configDir: join(homedir(), ".claude"),
    };
    const raw = `{"cwd":"${places.folder}","user_dir":"${homedir()}/notes","who":"${userInfo().username}","mail":"person@mail.test"}`;
    expect(() => assertNothingPrivate(raw, "a recording")).toThrow(PrivacyError);
    const redacted = redactText(raw, places);
    expect(redacted).toContain("/home/you/project");
    expect(redacted).not.toContain(homedir());
    expect(() => assertNothingPrivate(redacted, "a recording")).not.toThrow();
  });
});
