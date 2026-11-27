// The sidebar's markers: the Prime Working, the Worker Waiting, another Claude Session Idle
// and a shell with a Bell, beside the Workspaces that aren't open.
import { expect, test } from "./fixtures.ts";

test("the sidebar: Working, Waiting, Idle and a Bell", async ({ app, demo, kbench }) => {
  await demo.workspace("acme-api", ["dev server", "tests"], ["api tests"]);
  await demo.workspace("website", []);
  await demo.workspace("dotfiles", []);
  await app.openWorkspace("acme-api");
  await expect(app.marker("sidebar", "Prime", "idle")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "idle")).toBeVisible();
  await expect(app.marker("sidebar", "api tests", "idle")).toBeVisible();

  await kbench.ringBell("tests", "acme-api");
  await expect(app.bellBadge("tests")).toBeVisible();
  await demo.setState("Prime", "working", "acme-api");
  await demo.setState("Worker", "waiting", "acme-api");
  await expect(app.marker("sidebar", "Prime", "working")).toBeVisible();
  await expect(app.marker("sidebar", "Worker", "waiting")).toBeVisible();
  // The sidebar down to its last Workspace, leaving out the empty space below.
  const sidebar = await app.sidebar.boundingBox();
  const last = await app.workspace("dotfiles").boundingBox();
  if (!sidebar || !last) throw new Error("The sidebar is not visible");
  await demo.shoot("claude-states.png", {
    x: sidebar.x,
    y: sidebar.y,
    width: sidebar.width,
    height: last.y + last.height + 12 - sidebar.y,
  });
});
