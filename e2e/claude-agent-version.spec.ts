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
