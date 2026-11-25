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
  await expect(app.missingMark("project")).toBeVisible();
  await expect(app.missingMark("other")).toHaveCount(0);
  // The Session that was already running carries on.
  await expect(app.sessionStatus("session 1", "running")).toBeVisible();
  await app.session("session 1").click();
  await app.runMarker(app.terminal("session 1"), "kb-after-vanish-5252");
  // Starting a new one says why it can't.
  await app.createSession("project");
  await expect(app.sidebar.getByRole("alert")).toContainText("Folder does not exist");
  // Other Workspaces keep working.
  await app.openWorkspace("other");
  await expect(app.missingNotice("project")).toHaveCount(0);
  await app.createSession("other");
  await expect(app.session("session 1")).toHaveAttribute("aria-current", "true");
  await app.runMarker(app.terminal("session 1"), "kb-other-ok-5353");

  // The note under the Open Workspace offers Change folder.
  const restored = kbench.instance.makeFolder("restored");
  await app.openWorkspace("project");
  await app
    .missingNotice("project")
    .getByRole("button", { name: "Change folder" })
    .click();
  // It opens at the nearest folder above the missing one, with nothing to save yet.
  await expect(app.breadcrumb("~")).toHaveAttribute("aria-current", "location");
  await expect(app.page.getByRole("button", { name: "Save" })).toBeDisabled();
  await app.pickFolder(restored);
  await app.page.getByRole("button", { name: "Save" }).click();

  await expect(app.missingNotice("project")).toHaveCount(0);
  await expect(app.missingMark("project")).toHaveCount(0);
  await app.createSession("project");
  await expect(app.sessionStatus("session 2", "running")).toBeVisible();
});

test("a Missing Workspace's Panes say its folder is missing, and Change folder there fixes it", async ({
  app,
  kbench,
  page,
}) => {
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);
  // Its Prime and Worker haven't been started (only opening does that), and now can't be.
  rmSync(folder, { recursive: true });
  await page.reload();

  for (const side of ["left", "right"] as const) {
    await expect(app.pane(side)).toContainText("This Workspace's folder is missing");
    await expect(
      app.pane(side).getByRole("button", { name: "Change folder", exact: true }),
    ).toBeVisible();
  }

  const restored = kbench.instance.makeFolder("restored");
  await app
    .pane("right")
    .getByRole("button", { name: "Change folder", exact: true })
    .click();
  await app.pickFolder(restored);
  await app.page.getByRole("button", { name: "Save" }).click();

  // Fixing the Open Workspace's folder starts its Prime and Worker there.
  await expect(app.terminalIn("left", "Prime")).toContainText(
    `claude-stub cwd: ${restored}`,
  );
  await expect(app.terminalIn("right", "Worker")).toContainText("claude-stub ready");
  await expect(app.pane("left")).not.toContainText("folder is missing");
});
