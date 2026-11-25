import { expect, test } from "./harness.ts";

test("a new Workspace lists its Prime and Worker Stopped, with no Rename or Delete, and Restart starts them", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  for (const name of ["Prime", "Worker"]) {
    await expect(app.sessionStatus(name, "stopped")).toBeVisible();
    await app.sidebar
      .getByRole("button", { name: `Actions for ${name}`, exact: true })
      .click();
    const menu = app.page.getByRole("menu");
    const item = (label: string) =>
      menu.getByRole("menuitem", { name: label, exact: true });
    const restart = item("Restart");
    await expect(restart).toBeVisible();
    await expect(item("Rename")).toHaveCount(0);
    await expect(item("Delete")).toHaveCount(0);

    await restart.click();

    await expect(app.sessionStatus(name, "running")).toBeVisible();
    await app.session(name).click();
    await expect(app.terminal(name)).toContainText("claude-stub ready");
  }
});

test("clicking a Workspace's name opens it, starting its Prime and Worker", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await expect(app.sessionStatus("Prime", "stopped")).toBeVisible();

  await app.workspace("project").getByRole("button", { name: "project" }).click();

  await expect(app.sessionStatus("Prime", "running")).toBeVisible();
  await expect(app.sessionStatus("Worker", "running")).toBeVisible();
});
