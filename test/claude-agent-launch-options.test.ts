import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeReceived } from "./harness/fake-claude.ts";

// What reaches Claude Code is the contract with it (ADR-0005), so these tests read what the
// fake Claude Code was started with: the real Agent Runtime and the real Agent SDK ran it.

/** The flags the SDK started the fake with, and the environment variables the fake keeps. */
function started(received: FakeReceived[]) {
  const starts = received.flatMap((entry) => (entry.kind === "start" ? [entry] : []));
  expect(starts).toHaveLength(1);
  return starts[0] as Extract<FakeReceived, { kind: "start" }>;
}

describe("a Claude Agent's Launch options", () => {
  it("reach Claude Code as the flags and settings of that launch alone: the owner's own user settings are not touched, and no /advisor command is sent", async () => {
    const { instance, server, workspace } = await boot();
    const userSettings = join(instance.root, "user-settings.json");
    const ownerSettings = JSON.stringify({
      advisorModel: "owners-default",
      theme: "dark",
    });
    writeFileSync(userSettings, ownerSettings);
    instance.fakeClaude.configure({ userSettingsFile: userSettings });

    await server.createClaudeAgent(workspace.id, {
      claude: { model: "opus", effort: "xhigh", advisor: "sonnet", focusView: true },
    });

    const { argv, env } = started(instance.fakeClaude.received());
    expect(argv).toContain("--model=opus");
    expect(argv).toContain("--effort=xhigh");
    expect(argv.join(" ")).toContain("--advisor sonnet");
    const settings = argv[argv.indexOf("--settings") + 1] ?? "";
    expect(JSON.parse(settings)).toEqual({ viewMode: "focus" });
    expect(env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL).toBeUndefined();
    // The advisor is for this Session only: it is a flag, never a `/advisor` that the real
    // Claude Code would save as the owner's default.
    expect(instance.fakeClaude.prompts()).toEqual([]);
    expect(readFileSync(userSettings, "utf8")).toBe(ownerSettings);
  });

  it("add nothing for Default, and Advisor Off is the environment, never a flag", async () => {
    const { instance, server, workspace } = await boot();

    await server.createClaudeAgent(workspace.id, { name: "defaults" });
    const defaults = started(instance.fakeClaude.received());
    await server.createClaudeAgent(workspace.id, {
      name: "off",
      claude: { advisor: "off" },
    });
    const starts = instance.fakeClaude
      .received()
      .flatMap((entry) => (entry.kind === "start" ? [entry] : []));

    for (const flag of ["--model", "--effort", "--advisor", "--settings"]) {
      expect(defaults.argv.join(" ")).not.toContain(flag);
    }
    expect(defaults.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL).toBeUndefined();
    const off = starts[1];
    expect(off?.argv.join(" ")).not.toContain("--advisor");
    expect(off?.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL).toBe("1");
  });
});
