// The New Claude dialog, filled in. The image is the dialog alone, so no terminal shows.
import { test } from "./fixtures.ts";

test("the New Claude dialog", async ({ app, demo }) => {
  await demo.workspace("acme-api", []);
  await app.openWorkspace("acme-api");

  await app.openClaudeDialog("acme-api");
  await app.fillClaudeDialog({
    name: "api tests",
    model: "Sonnet",
    effort: "High",
    advisor: "Opus",
    focusView: true,
  });
  await demo.shoot("new-claude.png", app.claudeDialog);
});
