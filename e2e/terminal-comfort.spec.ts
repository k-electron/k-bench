import type { Locator, Page } from "@playwright/test";
import { type AppPage, expect, test } from "./harness.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Prints 100 numbered lines: well beyond one screen, yet few enough that scrolling back to
 * the top takes a few rounds of scroll steps, each of which is slow when the machine is busy.
 */
const PRINT_LINES = "printf 'scroll-%03d-end\\n' $(seq 1 100)";
/** The last line `PRINT_LINES` prints. */
const LAST_LINE = "scroll-100-end";

async function openSession(app: AppPage, folder: string) {
  await app.createWorkspace(folder);
  await app.createSession("project");
  return app.terminal("session 1");
}

/** Drags across the whole terminal row that shows `text`. */
async function dragAcrossLine(
  page: Page,
  terminal: Locator,
  text: string,
  shift = false,
) {
  const row = terminal.getByText(text).first();
  const box = await row.boundingBox();
  if (!box) throw new Error(`no visible row showing ${text}`);
  const y = box.y + box.height / 2;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  // The row is as wide as its text; end the drag beyond it so the last character is in.
  await page.mouse.move(box.x + box.width + 30, y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

test("scrolling up with the mouse wheel reveals earlier lines", async ({
  app,
  kbench,
  page,
}) => {
  const terminal = await openSession(app, kbench.instance.makeFolder("project"));
  await app.runCommand(terminal, PRINT_LINES, LAST_LINE);
  await expect(terminal).not.toContainText("scroll-003-end");

  await terminal.hover();
  // Each wheel step scrolls tmux a few lines; keep rolling until the top of the output shows.
  await expect
    .poll(async () => {
      for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -120);
      return (await terminal.textContent())?.includes("scroll-003-end");
    })
    .toBe(true);
});

test("swiping down on the terminal reveals earlier lines", async ({
  app,
  kbench,
  page,
}) => {
  const terminal = await openSession(app, kbench.instance.makeFolder("project"));
  await app.runCommand(terminal, PRINT_LINES, LAST_LINE);
  await expect(terminal).not.toContainText("scroll-003-end");
  const box = await terminal.boundingBox();
  if (!box) throw new Error("terminal not visible");
  const x = box.x + box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });

  await expect
    .poll(async () => {
      await touch("touchStart", box.y + 100);
      for (let step = 1; step <= 10; step++)
        await touch("touchMove", box.y + 100 + step * 40);
      await touch("touchEnd", 0);
      return (await terminal.textContent())?.includes("scroll-003-end");
    })
    .toBe(true);
});

test("text selected in the terminal lands on the system clipboard", async ({
  app,
  kbench,
  page,
}) => {
  const terminal = await openSession(app, kbench.instance.makeFolder("project"));
  await app.runMarker(terminal, "kb-copy-me-8813");

  await dragAcrossLine(page, terminal, "kb-copy-me-8813");

  await expect
    .poll(() => page.evaluate<string>("navigator.clipboard.readText()"))
    .toContain("kb-copy-me-8813");
});

test("shift-drag selects in the browser terminal as a fallback", async ({
  app,
  kbench,
  page,
}) => {
  const terminal = await openSession(app, kbench.instance.makeFolder("project"));
  await app.runMarker(terminal, "kb-shift-pick-5521");
  // What the browser's own copy command would put on the clipboard.
  await page.evaluate(`{
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (format, data) {
      if (format === "text/plain") window.copied = data;
      return setData.call(this, format, data);
    };
  }`);

  await dragAcrossLine(page, terminal, "kb-shift-pick-5521", true);
  await page.keyboard.press("ControlOrMeta+c");

  await expect
    .poll(() => page.evaluate<string | undefined>("window.copied"))
    .toContain("kb-shift-pick-5521");
});

test("a dropped connection shows a reconnecting badge, reconnects by itself and accepts input", async ({
  app,
  kbench,
  page,
}) => {
  const terminal = await openSession(app, kbench.instance.makeFolder("project"));
  await app.runMarker(terminal, "kb-before-restart-1001");
  const badge = page.getByRole("status").filter({ hasText: "reconnecting…" });
  await expect(badge).toBeHidden();

  await kbench.stopServer();
  await expect(badge).toBeVisible();

  await kbench.startServer();
  await expect(badge).toBeHidden();
  await expect(terminal).toContainText("kb-before-restart-1001");
  await app.runMarker(terminal, "kb-after-restart-2002");
});
