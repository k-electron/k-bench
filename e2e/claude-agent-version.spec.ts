import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, set to report a version; nothing
// here runs the real `claude`, and the Agent Runtime is the real one.

// The Claude Code the installed Agent SDK was made for, which the runtime reports in its hello.
const expected = (
  JSON.parse(
    readFileSync(
      join("node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"),
      "utf8",
    ),
  ) as { claudeCodeVersion: string }
).claudeCodeVersion;
const [major = "2", minor = "1", patch = "0"] = expected.split(".");

test("an Agent shows its claude version, and warns only when that claude is older than the SDK expects, starting either way", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  const older = `${major}.${minor}.${Number(patch) - 1}`;
  const newer = `${major}.${minor}.${Number(patch) + 1}`;

  for (const [name, version] of [
    ["older", older],
    ["same", expected],
    ["newer", newer],
  ] as const) {
    fakeClaude.configure({ version });
    await app.openNewSessionDialog("project");
    await app.createInDialog({ name, kind: "Claude Agent (WIP)" });
    await expect(app.newSessionDialog).toBeHidden();

    const region = app.agentRegion(name);
    await expect(region.getByRole("note", { name: "Claude Code" })).toContainText(
      `claude ${version}`,
    );
    const warning = region.getByRole("note", { name: "Version warning" });
    if (name === "older") {
      await expect(warning).toContainText(`(${older}) is older than ${expected}`);
    } else {
      await expect(warning).toHaveCount(0);
    }
    // It runs a turn all the same.
    await app.agentInput(name).fill("hello");
    await app.agentInput(name).press("Enter");
    await expect(region.getByRole("log")).toContainText("fake claude heard: hello");
  }
});

// Versions are compared as numbers, not as text, and one that cannot be read is no reason to warn.
test("an Agent compares claude versions numerically, and does not warn about one it cannot read", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  // As text, "2.1.99" sorts after the SDK's 2.1.3xx and "2.1.1000" before it.
  for (const [name, version, warns] of [
    ["fewer-digits", `${major}.${minor}.99`, true],
    ["more-digits", `${major}.${minor}.1000`, false],
    ["unreadable", "unknown", false],
  ] as const) {
    fakeClaude.configure({ version });
    await app.openNewSessionDialog("project");
    await app.createInDialog({ name, kind: "Claude Agent (WIP)" });
    await expect(app.newSessionDialog).toBeHidden();

    const region = app.agentRegion(name);
    await expect(region.getByRole("note", { name: "Claude Code" })).toContainText(
      `claude ${version}`,
    );
    const warning = region.getByRole("note", { name: "Version warning" });
    if (warns) {
      await expect(warning).toContainText(`(${version}) is older than ${expected}`);
    } else {
      await expect(warning).toHaveCount(0);
    }
  }
});
