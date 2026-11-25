// Desktop: the Open Workspace with a shell in the right Pane, then the same scene after a
// Session rings its Bell. The left Pane holds the Prime, which runs the test stub here.
import { expect, test } from "./fixtures.ts";

test("desktop with a Session in the right Pane, and a Session that rang the Bell", async ({
  app,
  kbench,
  demo,
}) => {
  await demo.workspace("acme-api", ["main", "tests"]);
  await demo.workspace("website", ["dev server"]);
  await demo.workspace("dotfiles", []);
  await expect(app.session("tests")).toBeVisible();

  await app.session("main").click();
  const right = app.terminalIn("right", "main");
  await expect(right).toBeVisible();

  await app.runMarker(right, "shellready");
  await app.runCommand(
    right,
    "clear; git log --oneline; ls -lg src; cat package.json",
    '"version": "1.4.0"',
  );
  await expect(right).toContainText("orders.ts");

  await demo.shoot("desktop.png");

  // "tests" is in no Pane, so nobody is looking at it when its shell rings the bell.
  await kbench.ringBell("tests");
  await expect(app.bellBadge("tests")).toBeVisible();
  await demo.shoot("bell.png");
});
