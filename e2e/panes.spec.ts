import { expect, test } from "./harness.ts";

test("clicking a Session opens it in the Focused Pane", async ({ app, kbench }) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.createSession("project");
  await app.showTwoPanes();

  // Pane 1 starts focused, and the marker says so.
  await expect(app.pane(1)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(2)).not.toHaveAttribute("aria-current", "true");

  await app.session("session 1").click();
  await expect(
    app.pane(1).getByRole("region", { name: "Terminal session 1" }),
  ).toBeVisible();

  // Clicking in the other Pane moves the focus there; the next click lands in it.
  await app.pane(2).click();
  await expect(app.pane(2)).toHaveAttribute("aria-current", "true");
  await expect(app.pane(1)).not.toHaveAttribute("aria-current", "true");
  await app.session("session 2").click();
  await expect(
    app.pane(2).getByRole("region", { name: "Terminal session 2" }),
  ).toBeVisible();
  await expect(
    app.pane(1).getByRole("region", { name: "Terminal session 1" }),
  ).toBeVisible();
});
