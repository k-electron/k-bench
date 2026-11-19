import { isResult } from "../test/harness/agent.ts";
import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; the Agent Runtime is the real one.

const TURNS = 30;

/** A prompt several lines tall, so a few turns fill the Pane and the page is scrollable. */
const prompt = (n: number) =>
  [
    `turn ${n} start`,
    ...Array.from({ length: 11 }, (_, i) => `line ${i + 2} of turn ${n}`),
  ].join("\n");

test("a long conversation opens on its latest turns, and scrolling up brings in the rest in place", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const conversation = app.agentRegion("session 1").getByRole("log");

  // A conversation of thirty turns, sent from a device that is not the page.
  const device = await kbench.openAgent("session 1");
  await device.sync();
  for (let n = 1; n <= TURNS; n += 1) {
    const done = device.entries.filter(isResult).length + 1;
    device.prompt(prompt(n));
    await expect
      .poll(() => device.entries.filter(isResult).length)
      .toBeGreaterThanOrEqual(done);
  }
  device.close();

  /** The numbers of the prompts on the page, in the order shown. */
  const shownTurns = async () =>
    (await conversation.getByText(/^turn \d+ start/).allTextContents()).flatMap(
      (text) => {
        const match = /^turn (\d+) start/.exec(text);
        return match ? [Number(match[1])] : [];
      },
    );

  // A fresh load shows the latest turns only.
  await app.page.reload();
  await expect(conversation).toContainText(`turn ${TURNS} start`);
  await expect.poll(shownTurns).toEqual([26, 27, 28, 29, 30]);

  // Scrolling to the top loads earlier turns, and what was on screen stays where it was.
  const anchor = conversation.getByText(/^turn 26 start/);
  const scrollToTop = () =>
    conversation.evaluate((element) => {
      element.scrollTop = 0;
    });
  const anchorTop = async () => (await anchor.boundingBox())?.y ?? Number.NaN;
  await scrollToTop();
  const before = await anchorTop();
  await expect.poll(async () => (await shownTurns()).length).toBeGreaterThan(5);
  expect(Math.abs((await anchorTop()) - before)).toBeLessThan(4);

  // And on, to the first entry: every turn once, in order.
  await expect
    .poll(async () => {
      await scrollToTop();
      return shownTurns();
    })
    .toEqual(Array.from({ length: TURNS }, (_, i) => i + 1));
  // Nothing is left to load, so scrolling up again changes nothing.
  await scrollToTop();
  await expect(
    app.agentRegion("session 1").getByText("Loading earlier messages…"),
  ).toHaveCount(0);
  expect(await shownTurns()).toEqual(Array.from({ length: TURNS }, (_, i) => i + 1));
});
