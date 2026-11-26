// The New Claude dialog, filled in. The image is the dialog alone, so no terminal shows.
import { test } from "./fixtures.ts";

test("the New Claude dialog", async ({ app, demo }) => {
  await demo.workspace("acme-api", []);
  await app.openWorkspace("acme-api");

  await app.openClaudeDialog("acme-api");
  const dialog = app.claudeDialog;
  await dialog.getByRole("textbox", { name: "Session name" }).fill("api tests");
  await dialog.getByLabel("Model", { exact: true }).selectOption("Sonnet");
  await dialog.getByLabel("Effort", { exact: true }).selectOption("High");
  await dialog.getByLabel("Advisor", { exact: true }).selectOption("Opus");
  await dialog.getByRole("checkbox", { name: "Focus view" }).check();
  await demo.shoot("new-claude.png", app.claudeDialog);
});
