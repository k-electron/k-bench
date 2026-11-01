import { rmSync } from "node:fs";
import { expect, test } from "./harness.ts";

test("a Workspace whose folder vanished is marked Missing with the reason, until its folder is changed", async ({
  app,
  kbench,
  page,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);
  await app.createWorkspace(kbench.instance.makeFolder("other"));
  await app.createSession("project");
  await app.runMarker(app.terminal("session 1"), "kb-before-vanish-5151");
  await expect(app.missingNotice("project")).toHaveCount(0);

  rmSync(folder, { recursive: true });
  await page.reload();

  await expect(app.missingNotice("project")).toContainText("Missing");
  await expect(app.missingNotice("project")).toContainText("Sessions can't start");
  await expect(app.missingNotice("other")).toHaveCount(0);
  // The Session that was already running carries on.
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
  await app.session("session 1").click();
  await app.runMarker(app.terminal("session 1"), "kb-after-vanish-5252");
  // Starting a new one says why it can't.
  await app.createSession("project");
  await expect(app.sidebar.getByRole("alert")).toContainText("Folder does not exist");
  // Other Workspaces keep working.
  await app.createSession("other");
  // Both Workspaces now have a "session 1": wait until the new one is the open Session.
  await expect(
    app.sidebar
      .getByRole("listitem")
      .filter({ has: app.page.getByRole("heading", { name: "other", exact: true }) })
      .getByRole("button", { name: "session 1", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await app.runMarker(app.terminal("session 1"), "kb-other-ok-5353");

  const restored = kbench.instance.makeFolder("restored");
  await app.workspaceAction("project", "Change folder");
  await app.page.getByRole("textbox", { name: "Folder path" }).fill(restored);
  await app.page.getByRole("button", { name: "Save" }).click();

  await expect(app.missingNotice("project")).toHaveCount(0);
  await app.createSession("project");
  await expect(app.sessionStatus("session 2", "running")).toBeVisible();
});
