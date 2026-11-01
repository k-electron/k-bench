import { expect, test } from "./harness.ts";

test("create a Workspace and a Session from an empty state, then type into the Pane", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("project");

  await app.createWorkspace(folder);
  await app.createSession("project");
  await app.session("session 1").click();

  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "kb-typed-1234567890");
  await expect(app.sidebar).toContainText("session 1");
});

test("after a page reload the same Session shows its earlier output", async ({
  app,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "kb-before-reload-4242");

  await page.reload();

  await expect(app.terminal("session 1")).toContainText("kb-before-reload-4242");
});

test("the terminal fits the Pane and resizes with the window", async ({
  app,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");

  const large = await app.terminalSize(terminal);
  // More than the 80x24 a terminal gets before it is fitted to the window.
  expect(large.cols).toBeGreaterThan(80);
  expect(large.rows).toBeGreaterThan(24);

  await page.setViewportSize({ width: 800, height: 500 });
  await expect
    .poll(async () => {
      const { cols, rows } = await app.terminalSize(terminal);
      return cols < large.cols && rows < large.rows;
    })
    .toBe(true);
});
