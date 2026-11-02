// Phone: the drawer listing Workspaces and Sessions, and a terminal with the extra keys.
import { expect, test } from "./fixtures.ts";

test("the phone layout: the drawer, then a terminal with the extra keys", async ({
  app,
  demo,
}) => {
  await demo.workspace("acme-api", ["main", "tests"]);
  await demo.workspace("website", ["dev server"]);
  await demo.workspace("dotfiles", []);

  await app.openDrawer();
  await expect(app.session("tests")).toBeVisible();
  await expect(app.session("dev server")).toBeVisible();
  await demo.shoot("phone-drawer.png");

  await app.session("main").tap();
  const terminal = app.terminal("main");
  await expect(terminal).toBeVisible();
  await app.runMarker(terminal, "shellready");
  await app.runCommand(
    terminal,
    "clear; git log --format='%C(yellow)%h%C(reset) %s'; ls",
    "README.md",
  );
  await expect(app.extraKey("Esc")).toBeVisible();
  await demo.shoot("phone-terminal.png");
});
