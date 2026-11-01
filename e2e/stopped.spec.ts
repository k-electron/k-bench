import { rmSync } from "node:fs";
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
  await app.restartSession("session 1");

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

  await app.restartSession("session 2");
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

  await app.restartSession("session 1");

  await expect(app.sidebar.getByRole("alert")).toContainText("Folder does not exist");
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();
});
