// Self-checks for the parts of `pnpm screenshots` that the images do not exercise while the
// hero recording is pending: playing a recording into a Session, and scrubbing one.
//
// THE RECORDING USED HERE IS A PLACEHOLDER. It is plain shell-style text, made up in this
// file, and is NOT Claude Code. It is written to a temp folder, never committed, and never
// photographed into docs/images.
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import {
  parseReplacement,
  plainText,
  type Recording,
  scrub,
  writeRecording,
} from "./recording.ts";

test("a recording plays back in a Session, on a cleared screen", async ({
  app,
  demo,
}) => {
  await demo.workspace("acme-api", ["replay"]);
  await app.session("replay").click();
  const terminal = app.terminal("replay");
  await expect(terminal).toBeVisible();
  const size = await app.terminalSize(terminal);

  const recording: Recording = {
    format: "k-bench-recording",
    version: 1,
    note: "PLACEHOLDER: plain text made up for the playback self-check. NOT Claude Code.",
    ...size,
    events: [
      [0, "placeholder recording, not Claude Code\r\n"],
      [50, "\x1b[32mgreen line\x1b[0m\r\n"],
      [4_000, "after a long pause\r\n"],
    ],
  };
  const file = join(demo.home, "placeholder.json");
  writeRecording(file, recording);

  const { command } = demo.playerCommand(file);
  await demo.play(app, terminal, file);

  await expect(terminal).toContainText("placeholder recording, not Claude Code");
  await expect(terminal).toContainText("green line");
  await expect(terminal).toContainText("after a long pause");
  // The screen was cleared first: neither the typed command nor the earlier output remains.
  await expect(terminal).not.toContainText(command);
  await expect(terminal).not.toContainText("shellready");
});

test("scrubbing rewrites a private string even when it is split across output chunks", () => {
  const recording: Recording = {
    format: "k-bench-recording",
    version: 1,
    note: "PLACEHOLDER: made up for the scrub self-check. NOT Claude Code.",
    cols: 80,
    rows: 24,
    events: [
      [0, "Welcome back, jane.roe@corp"],
      [120, ".test! \x1b[1mMax plan\x1b[0m\r\n"],
    ],
  };
  const scrubbed = scrub(recording, [
    parseReplacement("jane.roe@corp.test=>alice@example.com"),
    parseReplacement("Max plan=>Pro"),
  ]);

  expect(plainText(scrubbed)).toBe("Welcome back, alice@example.com ! Pro     \r\n");
  // Same chunks at the same moments, so playback is unchanged.
  expect(scrubbed.events.map(([ms]) => ms)).toEqual([0, 120]);
  expect(scrubbed.events.map(([, text]) => text.length)).toEqual(
    recording.events.map(([, text]) => text.length),
  );
  expect(() => parseReplacement("ab=>abc")).toThrow(/longer/);
});
