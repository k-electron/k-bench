import { expect, test } from "./harness.ts";

test("a Bell rung in a Session nobody is viewing shows a badge, and opening that Session clears it", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  // session 2 is the one on screen; session 1 is not viewed.
  await expect(app.bellBadge("session 1")).toHaveCount(0);

  await kbench.ringBell("session 1");

  await expect(app.bellBadge("session 1")).toBeVisible();
  await expect(app.bellBadge("session 2")).toHaveCount(0);

  await app.session("session 1").click();

  await expect(app.bellBadge("session 1")).toHaveCount(0);
  // And it stays cleared: opening the terminal did not leave a stale flag behind.
  await app.runMarker(app.terminal("session 1"), "kb-bell-cleared-4821");
  await expect(app.bellBadge("session 1")).toHaveCount(0);
});

test("a collapsed Workspace shows a rolled-up hint while any of its Sessions has a Bell", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createWorkspace(kbench.instance.makeFolder("other"));
  await app.createSessions("project", 2);
  await expect(app.workspaceBellHint("project")).toHaveCount(0);
  await app.collapseWorkspace("project");
  await expect(app.session("session 1")).toBeHidden();

  await kbench.ringBell("session 1");

  await expect(app.workspaceBellHint("project")).toBeVisible();
  await expect(app.workspaceBellHint("other")).toHaveCount(0);

  await app.expandWorkspace("project");

  await expect(app.bellBadge("session 1")).toBeVisible();
  // Expanded, the Sessions show their own badges instead of the roll-up.
  await expect(app.workspaceBellHint("project")).toHaveCount(0);

  await app.session("session 1").click();
  await app.collapseWorkspace("project");

  await expect(app.workspaceBellHint("project")).toHaveCount(0);
});

test("opening a Session with a Bell clears its badge on another device, without a reload", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await kbench.ringBell("session 1");
  await expect(otherDevice.bellBadge("session 1")).toBeVisible();

  await app.session("session 1").click();

  await expect(otherDevice.bellBadge("session 1")).toHaveCount(0);
});

test("a Bell rung while a showing Pane's terminal is reconnecting is cleared once it reconnects", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.session("session 1").click();
  await app.runMarker(app.terminal("session 1"), "kb-showing-7733");

  // The connection drops, so nothing views session 1 while it rings.
  await kbench.stopServer();
  await kbench.ringBell("session 1");
  // session 2 is not on screen: its badge shows once the bells have been noticed.
  await kbench.ringBell("session 2");
  await kbench.startServer();

  await expect(app.bellBadge("session 2")).toBeVisible();
  // The Pane's terminal reconnected, so the owner is viewing session 1: no badge may stay.
  await expect(app.bellBadge("session 1")).toHaveCount(0);
  await app.runMarker(app.terminal("session 1"), "kb-reconnected-7734");
});
