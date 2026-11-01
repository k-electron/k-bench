import { expect, test } from "./harness.ts";

test("clicking a Session opens it in the Focused Pane", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.showTwoPanes();

  // Pane 1 starts focused, and the marker says so.
  await expect(app.pane(1)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(2)).not.toHaveAttribute("aria-current", "true");

  await app.session("session 1").click();
  await expect(app.terminalIn(1, "session 1")).toBeVisible();

  // Clicking in the other Pane moves the focus there; the next click lands in it.
  await app.pane(2).click();
  await expect(app.pane(2)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(1)).not.toHaveAttribute("aria-current", "true");
  await app.session("session 2").click();
  await expect(app.terminalIn(2, "session 2")).toBeVisible();
  await expect(app.terminalIn(1, "session 1")).toBeVisible();
});

test("⌘-click and the row menu open a Session in the other Pane", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 3);
  await app.session("session 1").click();
  await expect(app.pane(2)).toHaveCount(0);

  // From one Pane, opening in the other Pane brings the second Pane up.
  await app.session("session 2").click({ modifiers: ["Meta"] });
  await expect(app.terminalIn(2, "session 2")).toBeVisible();
  await expect(app.terminalIn(1, "session 1")).toBeVisible();
  // The focus stays where it was.
  await expect(app.pane(1)).toHaveAttribute("aria-current", "true");

  await app.openInOtherPane("session 3");
  await expect(app.terminalIn(2, "session 3")).toBeVisible();
  await expect(app.terminalIn(1, "session 1")).toBeVisible();
  await expect(app.pane(1)).toHaveAttribute("aria-current", "true");
});

test("choosing the Session shown in the other Pane swaps the Panes", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.session("session 1").click();
  await app.session("session 2").click({ modifiers: ["Meta"] });
  await expect(app.terminalIn(2, "session 2")).toBeVisible();

  // Plain click on the Session in the other Pane: the two trade places.
  await app.session("session 2").click();
  await expect(app.terminalIn(1, "session 2")).toBeVisible();
  await expect(app.terminalIn(2, "session 1")).toBeVisible();
  await expect(app.terminal("session 1")).toHaveCount(1);
  await expect(app.terminal("session 2")).toHaveCount(1);

  // Opening it in the other Pane again swaps them back.
  await app.session("session 2").click({ modifiers: ["Meta"] });
  await expect(app.terminalIn(1, "session 1")).toBeVisible();
  await expect(app.terminalIn(2, "session 2")).toBeVisible();
  await expect(app.terminal("session 1")).toHaveCount(1);
  await expect(app.terminal("session 2")).toHaveCount(1);
});

test("the toggle switches between one and two Panes; ⌘\\ moves focus and the marker follows", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.session("session 1").click();
  await expect(app.pane(1)).toBeVisible();
  await expect(app.pane(2)).toHaveCount(0);

  await app.showTwoPanes();
  await app.session("session 2").click({ modifiers: ["Meta"] });
  await expect(app.terminalIn(2, "session 2")).toBeVisible();

  await app.page.keyboard.press("Meta+Backslash");
  await expect(app.pane(2)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(1)).not.toHaveAttribute("aria-current", "true");

  // Keystrokes now go to the Session in the newly focused Pane.
  await app.runMarker(app.terminal("session 2"), "kb-focus-moved-5150");

  await app.page.keyboard.press("Meta+Backslash");
  await expect(app.pane(1)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(2)).not.toHaveAttribute("aria-current", "true");

  // Back to one Pane: the Focused Pane's Session remains, and the second Pane is gone.
  await app.pane(2).click();
  await app.panesToggle.click();
  await expect(app.pane(2)).toHaveCount(0);
  await expect(app.terminalIn(1, "session 2")).toBeVisible();
  await app.page.keyboard.press("Meta+Backslash");
  await expect(app.pane(1)).toHaveAttribute("aria-current", "true");
});

test("after a reload the Pane count, both Sessions, the focus and the divider are restored", async ({
  app,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.session("session 1").click();
  await app.session("session 2").click({ modifiers: ["Meta"] });
  await page.keyboard.press("Meta+Backslash");
  await expect(app.pane(2)).toHaveAttribute("aria-current", "true");
  const before = Number(await app.divider.getAttribute("aria-valuenow"));
  await app.dragDivider(-250);
  await expect
    .poll(async () => Number(await app.divider.getAttribute("aria-valuenow")))
    .toBeLessThan(before);
  const dragged = await app.divider.getAttribute("aria-valuenow");

  await page.reload();

  await expect(app.terminalIn(1, "session 1")).toBeVisible();
  await expect(app.terminalIn(2, "session 2")).toBeVisible();
  await expect(app.pane(2)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(1)).not.toHaveAttribute("aria-current", "true");
  await expect(app.divider).toHaveAttribute("aria-valuenow", dragged ?? "");
  await expect(app.panesToggle).toHaveAttribute("aria-pressed", "true");
});

test("dragging the divider resizes both terminals and both shells see the new sizes", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);
  await app.session("session 1").click();
  await app.session("session 2").click({ modifiers: ["Meta"] });
  const left = app.terminal("session 1");
  const right = app.terminal("session 2");

  // Side by side, each shell settles on half the width (a shell probed while it is still
  // attaching may report the full width, hence the poll).
  let half = 0;
  await expect
    .poll(async () => {
      const [l, r] = [await app.terminalSize(left), await app.terminalSize(right)];
      half = l.cols;
      return l.cols === r.cols && l.cols < 100;
    })
    .toBe(true);

  await app.dragDivider(-250);

  await expect.poll(async () => (await app.terminalSize(left)).cols).toBeLessThan(half);
  await expect
    .poll(async () => (await app.terminalSize(right)).cols)
    .toBeGreaterThan(half);
});

test("without browser storage the default layout is used", async ({ page, kbench }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("storage unavailable");
      },
    });
  });
  await page.goto(kbench.url);
  await expect(page.getByRole("button", { name: "Two panes" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
