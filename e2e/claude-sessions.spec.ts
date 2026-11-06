import { expect, test } from "./harness.ts";

// Claude Code is the stub from test/harness/fake-claude.sh: the harness points the instance
// at it, so nothing here runs the real `claude`.

test("the + menu offers New shell and New Claude…, and New shell still starts a shell", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  await app.openNewSessionMenu("project");
  await expect(app.newSessionMenuItems).toHaveText(["New shell", "New Claude…"]);
  await app.page.keyboard.press("Escape");
  await app.createSession("project");

  await app.runMarker(app.terminal("session 1"), "kb-shell-still-works-31");
  await expect(app.claudeGlyph("session 1")).toHaveCount(0);
});

test("New Claude… launches Claude Code in a new Session, marked with a glyph on it alone", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);
  await app.createSession("project");

  await app.createClaudeSession("project");

  await expect(app.claudeDialog).toBeHidden();
  await expect(app.session("session 2")).toHaveAttribute("aria-current", "true");
  const terminal = app.terminalIn(1, "session 2");
  await expect(terminal).toContainText("claude-stub ready");
  await expect(terminal).toContainText(`claude-stub cwd: ${folder}`);
  await expect(terminal).toContainText("claude-stub arg: --session-id");
  await expect(app.claudeGlyph("session 2")).toBeVisible();
  await expect(app.claudeGlyph("session 1")).toHaveCount(0);
});

test("the Claude dialog opens with every option Default, and a choice reaches Claude Code", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  await app.openClaudeDialog("project");
  for (const field of ["Model", "Effort", "Advisor"]) {
    await expect(app.claudeDialog.getByLabel(field, { exact: true })).toHaveValue(
      "default",
    );
  }
  await expect(
    app.claudeDialog.getByRole("checkbox", { name: "Focus view" }),
  ).not.toBeChecked();
  await app.launchClaude({
    model: "Opus",
    effort: "XHigh",
    advisor: "Off",
    focusView: true,
  });

  const terminal = app.terminal("session 1");
  await expect(terminal).toContainText("claude-stub ready");
  await expect(terminal).toContainText("claude-stub arg: --model");
  await expect(terminal).toContainText("claude-stub arg: opus");
  await expect(terminal).toContainText("claude-stub arg: xhigh");
  await expect(terminal).toContainText("claude-stub advisor tool disabled: 1");
  await expect(terminal).toContainText("claude-stub arg: --settings");
  await expect(terminal).not.toContainText("claude-stub arg: --advisor");
});

test("the Claude dialog takes an optional name and refuses a taken one without closing", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeSession("project", { name: "refactor" });
  await expect(app.session("refactor")).toHaveAttribute("aria-current", "true");

  await app.openClaudeDialog("project");
  await app.launchClaude({ name: "refactor" });

  await expect(app.claudeDialog.getByRole("alert")).toContainText("already exists");
  await expect(app.claudeDialog).toBeVisible();
  await app.launchClaude({ name: "" });
  await expect(app.claudeDialog).toBeHidden();
  await expect(app.session("session 1")).toHaveAttribute("aria-current", "true");
  await expect(app.claudeGlyph("session 1")).toBeVisible();
});

test("quitting Claude Code stops the Session, and an error holds the screen until a key", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeSession("project");
  const terminal = app.terminal("session 1");
  await expect(terminal).toContainText("claude-stub ready");

  await app.runCommand(terminal, "exit 3", "Claude Code exited with an error.");
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
  await app.page.keyboard.press("q");

  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();

  await app.sessionMenu("session 1", "Restart");
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
  const again = app.terminal("session 1");
  await expect(again).toContainText("claude-stub ready");
  await app.page.keyboard.type("exit 0");
  await app.page.keyboard.press("Enter");
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
  await expect(app.claudeGlyph("session 1")).toBeVisible();
});
