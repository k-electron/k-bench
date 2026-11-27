import { expect, test } from "./harness.ts";

test("a Claude Session shows Working in a turn, Waiting while it asks, and Idle after it, live on every device", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.workspace("project").getByRole("button", { name: "project" }).click();
  await expect(app.marker("sidebar", "Prime", "idle")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("tab", "Worker", "idle")).toBeVisible();

  kbench.tellClaude("Worker", "think");

  await expect(app.marker("sidebar", "Worker", "working")).toBeVisible();
  await expect(app.marker("tab", "Worker", "working")).toBeVisible();
  await expect(otherDevice.marker("sidebar", "Worker", "working")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "idle")).toHaveCount(0);
  await expect(app.marker("sidebar", "Prime", "idle")).toBeVisible();

  kbench.tellClaude("Worker", "ask-permission");

  await expect(app.marker("sidebar", "Worker", "waiting")).toBeVisible();
  await expect(app.marker("tab", "Worker", "waiting")).toBeVisible();
  await expect(app.marker("tab", "Worker", "working")).toHaveCount(0);

  kbench.tellClaude("Worker", "a message");

  await expect(app.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("tab", "Worker", "idle")).toBeVisible();
  await expect(otherDevice.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "working")).toHaveCount(0);
});

test("a Claude Session shows Waiting until it is answered, ahead of a Bell on its folded Workspace's tile", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  // Opening a Workspace launches its Prime and Worker.
  await app.openWorkspace("alpha");
  await expect(app.marker("sidebar", "Prime", "idle")).toBeVisible();

  kbench.tellClaude("Prime", "think", "alpha");
  kbench.tellClaude("Prime", "ask-permission", "alpha");

  // The Prime is on screen, and viewing it doesn't clear Waiting.
  await expect(app.marker("sidebar", "Prime", "waiting")).toBeVisible();

  await app.openWorkspace("beta");
  await kbench.ringBell("Worker", "alpha");

  await expect(app.workspaceWaitingHint("alpha")).toBeVisible();
  await expect(app.workspaceBellHint("alpha")).toHaveCount(0);

  kbench.tellClaude("Prime", "answer", "alpha");

  await expect(app.workspaceBellHint("alpha")).toBeVisible();
  await expect(app.workspaceWaitingHint("alpha")).toHaveCount(0);
});

test("a Claude Session's Bell takes its marker's place until it is seen", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.workspace("project").getByRole("button", { name: "project" }).click();
  // A shell opens in the right Pane, so nothing views the Worker.
  await app.createSessions("project", 1);
  await expect(app.marker("sidebar", "Worker", "idle")).toBeVisible();

  await kbench.ringBell("Worker");

  await expect(app.marker("sidebar", "Worker", "bell")).toBeVisible();
  await expect(app.marker("tab", "Worker", "bell")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "idle")).toHaveCount(0);
  await expect(app.marker("tab", "Worker", "idle")).toHaveCount(0);

  await app.rightTab("Worker").click();

  await expect(app.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "bell")).toHaveCount(0);
});
