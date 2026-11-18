import { expect, test } from "./harness.ts";

// Claude Code is the stub from test/harness/fake-claude.sh: the harness points the instance
// at it, so nothing here runs the real `claude`.

test("the + button opens one dialog offering Shell, Claude TUI and Claude Agent, which opens on Shell the first time", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  await app.openNewSessionDialog("project");
  await expect(app.newSessionKinds).toHaveCount(3);
  await expect(
    app.newSessionDialog.getByRole("radio", { name: "Claude Agent (WIP)" }),
  ).toBeVisible();
  await expect(app.newSessionDialog.getByRole("radio", { name: "Shell" })).toBeChecked();
  // Launch options belong to Claude TUI only.
  await expect(app.newSessionDialog.getByLabel("Model", { exact: true })).toBeHidden();
  await expect(
    app.newSessionDialog.getByRole("checkbox", { name: "Focus view" }),
  ).toBeHidden();
  await app.newSessionDialog.getByRole("radio", { name: "Claude TUI" }).check();
  await expect(app.newSessionDialog.getByLabel("Model", { exact: true })).toBeVisible();
  await app.newSessionDialog.getByRole("radio", { name: "Shell" }).check();
  await expect(app.newSessionDialog.getByLabel("Model", { exact: true })).toBeHidden();
  await app.page.keyboard.press("Escape");

  await app.createSession("project");

  await app.runMarker(app.terminal("session 1"), "kb-shell-still-works-31");
  await expect(app.claudeGlyph("session 1")).toHaveCount(0);
});

test("Claude TUI launches Claude Code in a new Session, marked with a glyph on it alone", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);
  await app.createSession("project");

  await app.createClaudeSession("project");

  await expect(app.newSessionDialog).toBeHidden();
  await expect(app.session("session 2")).toHaveAttribute("aria-current", "true");
  const terminal = app.terminalIn(1, "session 2");
  await expect(terminal).toContainText("claude-stub ready");
  await expect(terminal).toContainText(`claude-stub cwd: ${folder}`);
  await expect(terminal).toContainText("claude-stub arg: --session-id");
  await expect(app.claudeGlyph("session 2")).toBeVisible();
  await expect(app.claudeGlyph("session 1")).toHaveCount(0);
});

test("Claude TUI's options start Default, and a choice reaches Claude Code", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  await app.openNewSessionDialog("project");
  await app.newSessionDialog.getByRole("radio", { name: "Claude TUI" }).check();
  for (const field of ["Model", "Effort", "Advisor"]) {
    await expect(app.newSessionDialog.getByLabel(field, { exact: true })).toHaveValue(
      "default",
    );
  }
  await expect(
    app.newSessionDialog.getByRole("checkbox", { name: "Focus view" }),
  ).not.toBeChecked();
  await app.createInDialog({
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

test("the dialog takes an optional name, launches on Enter, and refuses a taken name without closing", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeSession("project", { name: "refactor" });
  await expect(app.session("refactor")).toHaveAttribute("aria-current", "true");

  await app.openNewSessionDialog("project");
  // Enter does nothing until the Host's last kind has arrived; it opens on Claude TUI.
  await expect(
    app.newSessionDialog.getByRole("radio", { name: "Claude TUI" }),
  ).toBeChecked();
  const nameField = app.newSessionDialog.getByRole("textbox", { name: "Session name" });
  await nameField.fill("refactor");
  await nameField.press("Enter");

  // The refusal belongs to the name: it is the name field's description, and the field is invalid.
  await expect(nameField).toHaveAccessibleDescription(/already exists/);
  await expect(nameField).toHaveAttribute("aria-invalid", "true");
  await expect(app.newSessionDialog).toBeVisible();
  // Blank, and Enter: "session N", still a Claude Session (the kind the dialog opened on).
  await nameField.fill("");
  await nameField.press("Enter");
  await expect(app.newSessionDialog).toBeHidden();
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

test("the dialog reopens on the last kind and Launch options, on any device, with an empty name", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeSession("project", {
    name: "refactor",
    model: "Opus",
    effort: "High",
    advisor: "Off",
    focusView: true,
  });
  await expect(app.session("refactor")).toHaveAttribute("aria-current", "true");

  for (const device of [app, otherDevice]) {
    await device.openNewSessionDialog("project");
    const dialog = device.newSessionDialog;
    await expect(dialog.getByRole("radio", { name: "Claude TUI" })).toBeChecked();
    await expect(dialog.getByLabel("Model", { exact: true })).toHaveValue("opus");
    await expect(dialog.getByLabel("Effort", { exact: true })).toHaveValue("high");
    await expect(dialog.getByLabel("Advisor", { exact: true })).toHaveValue("off");
    await expect(dialog.getByRole("checkbox", { name: "Focus view" })).toBeChecked();
    await expect(dialog.getByRole("textbox", { name: "Session name" })).toHaveValue("");
    await device.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  // A shell made afterwards becomes the remembered kind, and the options wait behind it.
  await app.createSession("project");
  await expect(app.session("session 1")).toHaveAttribute("aria-current", "true");
  await otherDevice.openNewSessionDialog("project");
  await expect(
    otherDevice.newSessionDialog.getByRole("radio", { name: "Shell" }),
  ).toBeChecked();
  await otherDevice.newSessionDialog.getByRole("radio", { name: "Claude TUI" }).check();
  await expect(
    otherDevice.newSessionDialog.getByLabel("Model", { exact: true }),
  ).toHaveValue("opus");
});
