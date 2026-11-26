import { expect, test } from "./harness.ts";

test("a Claude Session shows Working in a turn and Idle after it, live on every device", async ({
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

  kbench.tellClaude("Worker", "a message");

  await expect(app.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("tab", "Worker", "idle")).toBeVisible();
  await expect(otherDevice.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "working")).toHaveCount(0);
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
