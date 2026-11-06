// Claude Sessions: the New Claude dialog, and the sidebar with the Claude glyph.
//
// No real Claude Code runs here: a Claude Session runs the test stub, whose terminal shows
// temporary paths. So neither image shows a Claude Session's terminal. The sidebar image is
// the sidebar alone, and the Session is never opened.
import { expect, test } from "./fixtures.ts";

test("the New Claude dialog, and the Claude glyph in the sidebar", async ({
  app,
  demo,
}) => {
  await demo.workspace("acme-api", [
    "main",
    { name: "orders refactor", claude: { model: "opus", effort: "high" } },
    { name: "docs pass", claude: { focusView: true } },
  ]);
  await demo.workspace("website", ["dev server"]);
  await expect(app.claudeGlyph("orders refactor")).toBeVisible();
  await expect(app.claudeGlyph("docs pass")).toBeVisible();
  await expect(app.claudeGlyph("main")).toHaveCount(0);
  // Only as far down as the last Session: the rest of the sidebar is empty.
  const sidebar = await app.sidebar.boundingBox();
  const last = await app.session("dev server").boundingBox();
  if (!sidebar || !last) throw new Error("The sidebar is not visible");
  await demo.shoot("claude-sidebar.png", {
    ...sidebar,
    height: last.y + last.height + 12 - sidebar.y,
  });

  await app.openClaudeDialog("acme-api");
  const dialog = app.claudeDialog;
  await dialog.getByRole("textbox", { name: "Session name" }).fill("api tests");
  await dialog.getByLabel("Model", { exact: true }).selectOption("Sonnet");
  await dialog.getByLabel("Effort", { exact: true }).selectOption("High");
  await dialog.getByLabel("Advisor", { exact: true }).selectOption("Opus");
  await dialog.getByRole("checkbox", { name: "Focus view" }).check();
  await demo.shoot("new-claude.png", app.claudeDialog);
});
