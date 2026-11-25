import { expect, test } from "./harness.ts";

test("an Other Session opened from the sidebar gets a tab in the right Pane; × removes only the tab, and the Workspace's name brings back the Worker", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.session("Worker").click();
  await expect(app.terminalIn("right", "Worker")).toBeVisible();

  await app.session("session 1").click();

  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await expect(app.rightTab("session 1")).toHaveAttribute("aria-current", "true");
  // The Worker's tab comes first and can't be closed.
  await expect(app.rightTab("Worker")).toBeVisible();
  await expect(app.closeTabButton("Worker")).toHaveCount(0);

  // A Bell rung in a hidden tab's Session shows on its tab.
  await kbench.ringBell("session 2");
  await expect(app.tabBell("session 2")).toBeVisible();

  // Closing the tab that's shown brings back the Worker; the Session keeps running.
  await app.closeTabButton("session 1").click();
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
  await expect(app.rightTab("session 1")).toHaveCount(0);
  await expect(app.session("session 1")).toBeVisible();

  await app.rightTab("session 2").click();
  await expect(app.terminalIn("right", "session 2")).toBeVisible();

  // The Workspace's name brings back Prime with Worker, keeping the tabs.
  await app.openWorkspace("project");
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await expect(app.rightTab("session 2")).toBeVisible();
});

test("another device shows the same right Pane tab after one changes it", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminalIn("right", "session 1")).toBeVisible();

  await expect(otherDevice.terminalIn("right", "session 1")).toBeVisible();
  await expect(otherDevice.rightTab("session 1")).toHaveAttribute("aria-current", "true");

  await app.closeTabButton("session 1").click();

  await expect(otherDevice.terminalIn("right", "Worker")).toBeVisible();
  await expect(otherDevice.rightTab("session 1")).toHaveCount(0);
});
