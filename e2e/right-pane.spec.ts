import { expect, test } from "./harness.ts";

test("an Other Session opened from the sidebar gets a tab in the right Pane; × removes only the tab, and the Workspace's name brings back the Worker", async ({
  app,
  kbench,
  page,
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
  // Loading k-bench again brings back what the right Pane showed.
  await page.reload();
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

test("a Session opened in the right Pane stays there while an older state push arrives, and what is typed reaches it", async ({
  app,
  kbench,
}) => {
  // The page's state pushes can be held back, to arrive late as on a slow network.
  let holding = false;
  const held: string[] = [];
  let deliver: (message: string) => void = () => {};
  await app.page.routeWebSocket(/\/api\/events$/, (page) => {
    const server = page.connectToServer();
    deliver = (message) => page.send(message);
    server.onMessage((message) => {
      if (holding) held.push(String(message));
      else page.send(message);
    });
  });
  await app.page.reload();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await expect(app.terminalIn("right", "session 2")).toBeVisible();

  // A change on the Host just before the owner opens session 1: its push, which still has
  // session 2 in the right Pane, is on its way when they click.
  holding = true;
  await kbench.ringBell("session 1");
  await expect.poll(() => held.length).toBeGreaterThan(0);
  const older = held.splice(0);
  await app.session("session 1").click();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();

  for (const message of older) deliver(message);
  // That push has shown (it carries the Bell), and session 1 is still on screen.
  await expect(app.bellBadge("session 1")).toBeVisible();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();

  holding = false;
  for (const message of held.splice(0)) deliver(message);
  await app.runMarker(app.terminalIn("right", "session 1"), "kb-stays-5521");
});
