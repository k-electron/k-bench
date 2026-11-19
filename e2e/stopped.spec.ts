import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { runtimesRoot } from "../src/agent/paths.ts";
import { killTmuxServer } from "../test/harness/tmux.ts";
import { expect, test } from "./harness.ts";

test("a Session whose shell exits is marked Stopped, and Restart brings back a usable terminal", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "kb-before-exit-1111");
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();

  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("exit");
  await app.page.keyboard.press("Enter");

  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await app.sessionMenu("session 1", "Restart");

  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
  await app.runMarker(app.terminal("session 1"), "kb-after-restart-2222");
});

test("after the tmux server dies every Session shows Stopped, the Workspace stays, and Restart works", async ({
  app,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.createSession("project");
  await expect(app.sessionStatus("session 2", "running")).toBeVisible();

  killTmuxServer(kbench.instance.config.tmuxSocket);
  await page.reload();

  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await expect(app.sessionStatus("session 2", "stopped")).toBeVisible();
  await expect(app.sidebar).toContainText("project");

  await app.sessionMenu("session 2", "Restart");
  await expect(app.sessionStatus("session 2", "running")).toBeVisible();
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await app.session("session 2").click();
  await app.runMarker(app.terminal("session 2"), "kb-after-reboot-3333");
});

test("restarting a Session whose folder is gone shows why and leaves it Stopped", async ({
  app,
  kbench,
  page,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);
  await app.createSession("project");
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
  killTmuxServer(kbench.instance.config.tmuxSocket);
  rmSync(folder, { recursive: true });
  await page.reload();
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();

  await app.sessionMenu("session 1", "Restart");

  await expect(app.sidebar.getByRole("alert")).toContainText("Folder does not exist");
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
});

// Claude Agents: Claude Code is the fake `claude`; the Agent Runtime is the real one.

test("stopping a Claude Agent mid-turn asks first, then leaves its whole conversation readable with the reason and Restart, which carries on the same conversation", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    { tool: { name: "Bash", input: { command: "make clean" } }, ask: true },
    { text: "cleaned" },
  ]);
  await app.agentInput("session 1").fill("clean up");
  await app.agentInput("session 1").press("Enter");
  await expect(app.permissionPrompt("session 1")).toBeVisible();

  await app.sessionMenu("session 1", "Stop");
  const confirm = app.page.getByRole("alertdialog", {
    name: "Claude is working. Stop anyway?",
  });
  // Backing out leaves it running, still asking.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(app.permissionPrompt("session 1")).toBeVisible();
  await app.sessionMenu("session 1", "Stop");
  await confirm.getByRole("button", { name: "Stop" }).click();

  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  const agent = app.agentRegion("session 1");
  const conversation = agent.getByRole("log");
  await expect(conversation).toContainText("clean up");
  // The ask was open when it stopped: it must not look approved, and has no buttons.
  await expect(conversation).toContainText("Not answered, the Agent stopped");
  await expect(app.permissionPrompt("session 1")).toHaveCount(0);
  await expect(agent).toContainText("Stopped: You stopped it");
  await expect(app.agentInput("session 1")).toHaveCount(0);

  // Restart resumes: the input is back, the earlier turn is still there, and it answers.
  await agent.getByRole("button", { name: "Restart" }).click();
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(conversation).toContainText("clean up");
  await app.agentInput("session 1").fill("still there?");
  await app.agentInput("session 1").press("Enter");
  await expect(conversation).toContainText("fake claude heard: still there?");

  // From Idle there is nothing to confirm.
  await app.sessionMenu("session 1", "Stop");
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await expect(conversation).toContainText("fake claude heard: still there?");
  await expect(agent.getByRole("button", { name: "Restart" })).toBeVisible();
});

test("a Claude Agent whose runtime is killed shows Stopped with a reason and its open ask as not answered, and is not started again by itself", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  kbench.instance.fakeClaude.script([
    { tool: { name: "Bash", input: { command: "ls" } }, ask: true },
  ]);
  await app.agentInput("session 1").fill("list it");
  await app.agentInput("session 1").press("Enter");
  await expect(app.permissionPrompt("session 1")).toBeVisible();

  // Only this instance's runtime: its path is inside the test's own data directory.
  execFileSync("pkill", ["-9", "-f", runtimesRoot(kbench.instance.config.dataDir)]);

  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  const agent = app.agentRegion("session 1");
  await expect(agent).toContainText("Stopped:");
  await expect(agent.getByRole("log")).toContainText("Not answered, the Agent stopped");
  await expect(app.permissionPrompt("session 1")).toHaveCount(0);

  // A new k-bench leaves it as it was.
  await kbench.stopServer();
  await kbench.startServer();
  await app.page.reload();
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText("list it");
});
