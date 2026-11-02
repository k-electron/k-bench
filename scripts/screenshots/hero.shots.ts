// The hero image: real Claude Code running in a Pane, played back from a recording.
//
// STATUS: recorded. docs/recordings/claude-hero.json is one real Claude Code run, made in a
// made-up demo project on the owner's account and scrubbed. If it is absent this test is
// skipped and no hero.png is made. To make or redo it:
//
//   1. Make a demo project: a folder named acme-api (any small, made-up code) and `cd` there.
//   2. Record it, in a terminal at least 110 columns by 32 rows. Claude Code starts in the
//      recording and runs one short task you type; leave with /exit or Ctrl-D:
//
//        pnpm screenshots:record
//
//      That saves the raw output to .scratch/claude-hero.raw.json (git-ignored). It has the
//      Claude banner in it: account, plan, email, organisation and the folder's real path.
//   3. Scrub it. Name every private string with `--replace "private=>public"` (the public
//      text is padded to the same width, and may not be longer, so the banner keeps its
//      shape). The private strings come from your command line or the environment, never
//      from the repo:
//
//        pnpm screenshots:scrub \
//          --replace "<your email>=>alice@example.com" \
//          --replace "<your plan>=>Claude Pro" \
//          --replace "<the real folder path>=>~/code/acme-api" \
//          --print
//
//      or K_BENCH_SCRUB="<private>=><public>" (one pair per line). It also looks for this
//      machine's username, host name and home folder and for emails, /Users paths, tailnet
//      names and plan names, and refuses to write the recording while any remain. `--print`
//      shows the recording as plain text so you can read all of it first.
//   4. Run `pnpm screenshots`, open docs/images/hero.png and check it yourself. This test
//      also fails if the page shows anything it recognises as private.
//   5. Commit docs/recordings/claude-hero.json and docs/images/hero.png.
import { existsSync } from "node:fs";
import { expect, fitTerminal, test } from "./fixtures.ts";
import { HERO_RECORDING } from "./images.ts";
import { readRecording } from "./recording.ts";

test("hero: Claude Code in a Pane", async ({ app, demo, page }) => {
  test.skip(
    !existsSync(HERO_RECORDING),
    "pending owner recording: docs/recordings/claude-hero.json does not exist yet",
  );
  const recording = readRecording(HERO_RECORDING);

  await demo.workspace("acme-api", ["claude"]);
  await demo.workspace("website", ["dev server"]);
  await demo.workspace("dotfiles", []);
  await app.session("claude").click();
  const terminal = app.terminal("claude");
  await expect(terminal).toBeVisible();
  await fitTerminal(app, page, terminal, recording);

  await demo.play(app, terminal, HERO_RECORDING);
  await demo.shoot("hero.png");
});
