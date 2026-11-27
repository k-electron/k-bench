import { echoCommand } from "../test/harness/terminal.ts";
import { expect, test } from "./harness.ts";

test("opening a Workspace shows its Prime on the left and its Worker on the right, named in the top bar and the title", async ({
  app,
  kbench,
  page,
}) => {
  const one = kbench.instance.makeFolder("one");
  const two = kbench.instance.makeFolder("two");
  await app.createWorkspace(one, { name: "alpha" });
  await app.createWorkspace(two, { name: "beta" });

  // Loading k-bench opens the Open Workspace (the first, as none was opened), starting it.
  await page.reload();
  await expect(app.terminalIn("left", "Prime")).toContainText(`claude-stub cwd: ${one}`);
  await expect(app.terminalIn("left", "Prime")).toContainText("claude-stub ready");
  await expect(app.terminalIn("right", "Worker")).toContainText("claude-stub ready");
  await expect(app.workspaceTitle).toHaveText("alpha");
  await expect(page).toHaveTitle("alpha — k-bench");

  await app.openWorkspace("beta");

  await expect(app.terminalIn("left", "Prime")).toContainText(`claude-stub cwd: ${two}`);
  await expect(app.terminalIn("left", "Prime")).toContainText("claude-stub ready");
  await expect(app.terminalIn("right", "Worker")).toContainText(
    `claude-stub cwd: ${two}`,
  );
  await expect(app.terminalIn("right", "Worker")).toContainText("claude-stub ready");
  await expect(app.pane("left")).toContainText("Prime");
  await expect(app.workspaceTitle).toHaveText("beta");
  await expect(app.workspaceTitle).toHaveAttribute("title", two);
  await expect(page).toHaveTitle("beta — k-bench");
});

test("an Other Session opens in the right Pane, never the left, and only Pane Sessions are highlighted; the top bar names the Session with the keyboard", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSessions("project", 2);

  await expect(app.terminalIn("right", "session 2")).toBeVisible();
  await app.session("session 1").click();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await expect(app.workspaceTitle).toHaveText("project");
  await expect(app.headerSession).toHaveText("session 1");
  // The top bar follows the keyboard into the other Pane.
  await app.terminalIn("left", "Prime").click();
  await expect(app.headerSession).toHaveText("Prime");
  await expect(app.terminal("session 2")).toHaveCount(0);
  await expect(app.pane("left").getByRole("region")).toHaveAccessibleName(
    "Terminal Prime",
  );
  await expect(app.session("session 1")).toHaveAttribute("aria-current", "true");
  await expect(app.session("Prime")).toHaveAttribute("aria-current", "true");
  await expect(app.session("session 2")).not.toHaveAttribute("aria-current", "true");

  // Choosing the Worker brings it back on the right.
  await app.session("Worker").click();
  await expect(app.pane("right").getByRole("region")).toHaveAccessibleName(
    "Terminal Worker",
  );
  await expect(app.terminal("session 1")).toHaveCount(0);
});

test("another device follows when one opens a Workspace", async ({
  app,
  otherDevice,
  kbench,
}) => {
  const two = kbench.instance.makeFolder("two");
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(two, { name: "beta" });
  await expect(otherDevice.workspaceTitle).toHaveText("alpha");

  await app.openWorkspace("beta");

  await expect(otherDevice.workspaceTitle).toHaveText("beta");
  await expect(otherDevice.page).toHaveTitle("beta — k-bench");
  await expect(otherDevice.terminalIn("left", "Prime")).toContainText(
    `claude-stub cwd: ${two}`,
  );
});

test("dragging the divider resizes the right Pane's terminal and its shell sees the new size", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const right = app.terminalIn("right", "session 1");
  const before = (await app.terminalSize(right)).cols;

  await app.dragDivider(250);

  await expect
    .poll(async () => (await app.terminalSize(right)).cols)
    .toBeLessThan(before);
});

test("dragging the divider to an edge shuts the left Pane to a rail, and opening it again brings back the divider where it was", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await app.dragDivider(-200);
  const ratio = await app.dividerPercent();
  expect(ratio).toBeLessThan(40);

  await app.shutPane("left");

  await expect(app.rail("left", "Prime")).toBeVisible();
  await expect(app.terminal("Prime")).toHaveCount(0);
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
  await app.rail("left", "Prime").hover();
  await expect(app.page.getByRole("tooltip", { name: "Show Prime" })).toBeVisible();

  await app.rail("left", "Prime").click();

  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  expect(await app.dividerPercent()).toBe(ratio);

  // Opening the Prime from the sidebar reopens its shut Pane too.
  await app.shutPane("left");
  await expect(app.rail("left", "Prime")).toBeVisible();
  await app.session("Prime").click();
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  expect(await app.dividerPercent()).toBe(ratio);

  // Double-clicking the divider gives half and half.
  await app.divider.dblclick();
  await expect(app.divider).toHaveAttribute("aria-valuenow", "50");
});

test("each Workspace's divider and shut Pane are kept on this device across a reload, and not on another device", async ({
  app,
  otherDevice,
  kbench,
  page,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await app.dragDivider(-200);
  const alphaRatio = await app.dividerPercent();
  await app.openWorkspace("beta");
  await expect(app.workspaceTitle).toHaveText("beta");
  await app.shutPane("right");
  await expect(app.rail("right", "Worker")).toBeVisible();

  await page.reload();

  await expect(app.workspaceTitle).toHaveText("beta");
  await expect(app.rail("right", "Worker")).toBeVisible();
  await expect(app.terminalIn("left", "Prime")).toBeVisible();
  await expect(otherDevice.terminalIn("right", "Worker")).toBeVisible();
  await app.openWorkspace("alpha");
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
  expect(await app.dividerPercent()).toBe(alphaRatio);
});

test("choosing a Workspace by its name brings it back as it was left on this device: its shown tab, its shut Pane and the Pane with the keyboard", async ({
  app,
  otherDevice,
  kbench,
  page,
}) => {
  /** Types into whichever terminal has the keyboard, without clicking it first. */
  const typeLine = async (line: string) => {
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  };
  const input = (side: "left" | "right", name: string) =>
    app.terminalIn(side, name).getByRole("textbox", { name: "Terminal input" });

  await app.createWorkspace(kbench.instance.makeFolder("one"), { name: "alpha" });
  await app.createSession("alpha");
  await expect(app.headerSession).toHaveText("session 1");
  await app.createWorkspace(kbench.instance.makeFolder("two"), { name: "beta" });
  // A new Workspace opens on its Prime, with the Worker on the right.
  await app.openWorkspace("beta");
  await expect(app.workspaceTitle).toHaveText("beta");
  await expect(app.headerSession).toHaveText("Prime");
  await expect(app.terminalIn("right", "Worker")).toBeVisible();
  // The keyboard moves to the Worker, whose Pane is then shut: it goes to the open Pane.
  await app.terminalIn("right", "Worker").click();
  await expect(app.headerSession).toHaveText("Worker");
  await app.shutPane("right");
  await expect(app.rail("right", "Worker")).toBeVisible();

  for (const round of [1, 2]) {
    await app.openWorkspace("alpha");
    await expect(app.rightTab("session 1")).toHaveAttribute("aria-current", "true");
    await expect(app.headerSession).toHaveText("session 1");
    await expect(input("right", "session 1")).toBeFocused();
    await typeLine(echoCommand(`kb-alpha-${round}`));
    await expect(app.terminalIn("right", "session 1")).toContainText(`kb-alpha-${round}`);

    await app.openWorkspace("beta");
    await expect(app.rail("right", "Worker")).toBeVisible();
    await expect(app.headerSession).toHaveText("Prime");
    await expect(input("left", "Prime")).toBeFocused();
    await typeLine(`kb-beta-${round}`);
    await expect(app.terminalIn("left", "Prime")).toContainText(
      `claude-stub heard: kb-beta-${round}`,
    );
  }

  // Kept across a reload on this device, and not on another.
  await app.openWorkspace("alpha");
  await expect(app.headerSession).toHaveText("session 1");
  await page.reload();
  await expect(app.headerSession).toHaveText("session 1");
  await expect(input("right", "session 1")).toBeFocused();
  await typeLine(echoCommand("kb-reloaded"));
  await expect(app.terminalIn("right", "session 1")).toContainText("kb-reloaded");
  await expect(otherDevice.workspaceTitle).toHaveText("alpha");
  await expect(otherDevice.terminalIn("right", "session 1")).toBeVisible();
  await expect(otherDevice.headerSession).toHaveText("Prime");
});

test("a Bell rung in a shut Pane's Session shows on its rail", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await app.shutPane("right");
  await expect(app.rail("right", "session 1")).toBeVisible();
  await expect(app.railBell("right", "session 1")).toHaveCount(0);

  await kbench.ringBell("session 1");

  await expect(app.railBell("right", "session 1")).toBeVisible();

  // Opening the Session from the sidebar reopens the Pane, and seeing it clears the Bell.
  await app.session("session 1").click();
  await expect(app.terminalIn("right", "session 1")).toBeVisible();
  await expect(app.bellBadge("session 1")).toHaveCount(0);
});
