// Phone: a shell Session in the Phone layout, with the Extra keys along the bottom. The dot on
// the title's Workspace is the dev server's Bell, and the pulsing one on the Menu button is
// the website Workspace's Waiting Prime.
import { expect, test } from "./fixtures.ts";

test("the Phone layout: a Session with the Extra keys", async ({ app, demo, kbench }) => {
  await demo.workspace("acme-api", ["shell", "dev server"]);
  await demo.workspace("website", []);
  await demo.workspace("dotfiles", []);

  // Opening website launches its Prime, which then waits on the owner.
  await app.openDrawer();
  await app.openWorkspace("website");
  await expect(app.marker("title", "Prime", "idle")).toBeVisible();
  await demo.setState("Prime", "waiting", "website");
  await expect(app.marker("title", "Prime", "waiting")).toBeVisible();

  await app.openDrawer();
  await app.openWorkspace("acme-api");
  await expect(app.marker("title", "Prime", "idle")).toBeVisible();
  await app.openDrawer();
  await app.session("shell").tap();
  const terminal = app.terminal("shell");
  await expect(terminal).toBeVisible();
  await expect(app.phoneTitle).toContainText("shell");
  await app.runMarker(terminal, "shellready");
  await app.runCommand(
    terminal,
    "clear; git log --format='%C(yellow)%h%C(reset) %s'; ls",
    "README.md",
  );
  await kbench.ringBell("dev server", "acme-api");
  await expect(app.titleBell).toBeVisible();
  await expect(app.menuWaiting).toBeVisible();
  await expect(app.extraKey("Esc")).toBeVisible();
  await demo.shoot("phone-terminal.png");
});
