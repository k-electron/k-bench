// Desktop: the Open Workspace with Claude Code in the Prime (the hero recording, played
// back, its turn over, so Idle) and a dev server in the right Pane, whose Tabs show the
// Worker, Working, and the dev server. The folded website Workspace has a Waiting Prime, so
// its tile pulses.
import { expect, fitTerminal, test } from "./fixtures.ts";
import { HERO_RECORDING } from "./images.ts";
import { readRecording } from "./recording.ts";

// The left Pane's share of the two Panes: wide enough for the recording, leaving the dev
// server room to read.
const PRIME_SHARE = 0.62;

test("desktop: the Prime, and a dev server in the right Pane", async ({
  app,
  demo,
  page,
}) => {
  const recording = readRecording(HERO_RECORDING);
  await demo.workspace("acme-api", ["dev server", "tests"]);
  await demo.workspace("website", []);
  await demo.workspace("dotfiles", []);
  await demo.waitingElsewhere(app, "website");
  await app.openWorkspace("acme-api");
  await expect(app.sessionStatus("Prime", "running")).toBeVisible();
  await expect(app.sessionStatus("Worker", "running")).toBeVisible();

  await app.session("dev server").click();
  const right = app.terminalIn("right", "dev server");
  await expect(right).toBeVisible();
  await expect(app.rightTab("Worker")).toBeVisible();
  await expect(app.rightTab("dev server")).toHaveAttribute("aria-current", "true");
  await app.runMarker(right, "shellready");
  await app.runCommand(right, "clear; dev-server", "Ready in");

  await app.dragDividerTo(PRIME_SHARE);
  const prime = app.terminalIn("left", "Prime");
  await fitTerminal(app, page, prime, recording, PRIME_SHARE);
  await demo.play(app, prime, HERO_RECORDING);
  await expect(right).toContainText("GET /owed");
  await demo.setState("Worker", "working", "acme-api");
  await expect(app.marker("tab", "Worker", "working")).toBeVisible();
  await expect(app.marker("sidebar", "Prime", "idle")).toBeVisible();
  await expect(app.workspaceWaitingHint("website")).toBeVisible();
  await demo.shoot("desktop.png");
});
