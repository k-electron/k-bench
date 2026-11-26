// Phone: a shell Session in the Phone layout, with the Extra keys along the bottom.
import { expect, test } from "./fixtures.ts";

test("the Phone layout: a Session with the Extra keys", async ({ app, demo }) => {
  await demo.workspace("acme-api", ["shell", "dev server"]);
  await demo.workspace("website", []);
  await demo.workspace("dotfiles", []);

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
  await expect(app.extraKey("Esc")).toBeVisible();
  await demo.shoot("phone-terminal.png");
});
