// Desktop: two Panes side by side, then the same scene after a Session rings its Bell.
import { expect, test } from "./fixtures.ts";

test("desktop with two Panes, and a Session that rang the Bell", async ({
  app,
  kbench,
  demo,
}) => {
  await demo.workspace("acme-api", ["main", "tests"]);
  await demo.workspace("website", ["dev server"]);
  await demo.workspace("dotfiles", []);
  await expect(app.session("tests")).toBeVisible();

  await app.session("main").click();
  await app.session("dev server").click({ modifiers: ["Meta"] });
  const left = app.terminalIn(1, "main");
  const right = app.terminalIn(2, "dev server");
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();

  await app.runMarker(left, "shellready");
  await app.runCommand(
    left,
    "clear; git log --oneline; ls -lg src; cat package.json",
    '"version": "1.4.0"',
  );
  await app.runMarker(right, "shellready");
  await app.runCommand(right, "clear; dev-server", "GET /about");
  await expect(left).toContainText("orders.ts");

  await demo.shoot("desktop.png");

  // "tests" is in no Pane, so nobody is looking at it when its shell rings the bell.
  await kbench.ringBell("tests");
  await expect(app.bellBadge("tests")).toBeVisible();
  await demo.shoot("bell.png");
});
