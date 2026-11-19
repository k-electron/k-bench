import type { Page } from "@playwright/test";
import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh: nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

/** The list's entry for a kind, in the dialog the sidebar's Unsupported button opens. */
const entry = (page: Page, kind: string) =>
  page
    .getByRole("list", { name: "Unsupported kinds" })
    .getByRole("listitem")
    .filter({ hasText: kind });

/** Opens the list afresh (it is read when opened) and runs `check`, until it holds. */
async function expectList(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.getByRole("button", { name: "Unsupported", exact: true }).click();
    try {
      await expect(page.getByRole("dialog", { name: "Unsupported" })).toBeVisible();
      await check();
    } finally {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }).toPass();
}

test("the list of unsupported kinds counts each thing once however many devices show it, is the same on every device and after a restart, links the Session, and a cleared kind returns when it happens again", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await app.createClaudeAgent("project");
  const send = async (text: string) => {
    await app.agentInput("session 1").fill(text);
    await app.agentInput("session 1").press("Enter");
  };
  await app.session("session 1").click();
  await expectList(app.page, async () => {
    await expect(app.page.getByText("Nothing unsupported yet.")).toBeVisible();
  });

  // Something k-bench does not know, which a second device is looking at too.
  await otherDevice.session("session 1").click();
  kbench.instance.fakeClaude.script([
    { text: "Trying something." },
    { raw: { type: "mystery_kind", payload: { n: 42 } } },
    { text: "That is all." },
  ]);
  await send("try it");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "That is all.",
  );
  await expect(otherDevice.agentRegion("session 1").getByRole("log")).toContainText(
    "That is all.",
  );

  // Two devices saw the same occurrence: once.
  await expectList(app.page, async () => {
    await expect(entry(app.page, "message:mystery_kind")).toContainText("1 time");
  });

  // It is the same list on the other device, and it names the Session.
  await expectList(otherDevice.page, async () => {
    await expect(entry(otherDevice.page, "message:mystery_kind")).toContainText("1 time");
    await expect(
      entry(otherDevice.page, "message:mystery_kind").getByRole("button", {
        name: "Open session 1",
      }),
    ).toBeVisible();
  });

  // The second time.
  kbench.instance.fakeClaude.script([{ raw: { type: "mystery_kind" } }]);
  await send("again");
  await expectList(app.page, async () => {
    await expect(entry(app.page, "message:mystery_kind")).toContainText("2 times");
  });

  // It survives a restart of k-bench.
  await kbench.stopServer();
  await kbench.startServer();
  await app.page.reload();
  await expectList(app.page, async () => {
    await expect(entry(app.page, "message:mystery_kind")).toContainText("2 times");
  });

  // Its link opens the Session.
  await app.session("session 2").click();
  await expect(app.agentRegion("session 2")).toBeVisible();
  await app.page.getByRole("button", { name: "Unsupported", exact: true }).click();
  await entry(app.page, "message:mystery_kind")
    .getByRole("button", { name: "Open session 1" })
    .click();
  await expect(app.agentRegion("session 1")).toBeVisible();
  await expect(app.page.getByRole("dialog")).toHaveCount(0);

  // Clearing removes it, here and on the other device...
  await app.page.getByRole("button", { name: "Unsupported", exact: true }).click();
  await entry(app.page, "message:mystery_kind")
    .getByRole("button", { name: "Clear message:mystery_kind" })
    .click();
  await expect(entry(app.page, "message:mystery_kind")).toHaveCount(0);
  await app.page.keyboard.press("Escape");
  await expectList(otherDevice.page, async () => {
    await expect(entry(otherDevice.page, "message:mystery_kind")).toHaveCount(0);
  });

  // ...and what already happened does not bring it back: only a new occurrence does.
  await app.page.reload();
  await app.session("session 1").click();
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "That is all.",
  );
  await expectList(app.page, async () => {
    await expect(entry(app.page, "message:mystery_kind")).toHaveCount(0);
  });
  kbench.instance.fakeClaude.script([{ raw: { type: "mystery_kind" } }]);
  await send("once more");
  await expectList(app.page, async () => {
    await expect(entry(app.page, "message:mystery_kind")).toContainText("1 time");
  });
});
