import { killTmuxServer } from "../test/harness/tmux.ts";
import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh: the SDK-driven one for the Agent and
// the terminal stub while the Session is in the terminal. Both save the conversation to the
// instance's own Claude Code folder, which the (real) Agent Runtime reads on the way back.
// Nothing here runs the real `claude`.

test("Open in web always asks, then switches the same Session back with the terminal's turns once, on every device", async ({
  app,
  otherDevice,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await otherDevice.session("session 1").click();
  await app.agentInput("session 1").fill("before");
  await app.agentInput("session 1").press("Enter");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: before",
  );
  await app.sessionMenu("session 1", "Open in terminal");
  await expect(app.terminal("session 1")).toContainText("claude-stub ready");
  await app.runCommand(
    app.terminal("session 1"),
    "from the terminal",
    "claude-stub heard: from the terminal",
  );
  await expect(otherDevice.terminal("session 1")).toContainText(
    "claude-stub heard: from the terminal",
  );

  // Always asked, even though nothing looks busy; backing out leaves the terminal as it was.
  await app.page.getByRole("button", { name: "Open in web", exact: true }).click();
  const confirm = app.page.getByRole("alertdialog", { name: "Open in web?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(app.terminal("session 1")).toBeVisible();
  await app.page.getByRole("button", { name: "Open in web", exact: true }).click();
  await confirm.getByRole("button", { name: "Open in web" }).click();

  for (const device of [app, otherDevice]) {
    const log = device.agentRegion("session 1").getByRole("log");
    await expect(log).toContainText("fake claude heard: before");
    await expect(log).toContainText("claude-stub heard: from the terminal");
    await expect(log.getByRole("article", { name: "In the terminal" })).toHaveCount(1);
    await expect(log.getByRole("article", { name: "Back in web" })).toHaveCount(1);
    await expect(device.terminal("session 1")).toHaveCount(0);
  }
  // The terminal's turns are between the dividers, after the Agent's own.
  const text = (await app.agentRegion("session 1").getByRole("log").textContent()) ?? "";
  expect(text.indexOf("fake claude heard: before")).toBeLessThan(
    text.indexOf("In the terminal"),
  );
  expect(text.indexOf("In the terminal")).toBeLessThan(
    text.indexOf("claude-stub heard: from the terminal"),
  );
  expect(text.indexOf("claude-stub heard: from the terminal")).toBeLessThan(
    text.indexOf("Back in web"),
  );
  // It is the same Session, and the Agent carries on in the conversation.
  await expect(app.session("session 1")).toHaveCount(1);
  await app.agentInput("session 1").fill("after");
  await app.agentInput("session 1").press("Enter");
  await expect(app.agentRegion("session 1").getByRole("log")).toContainText(
    "fake claude heard: after",
  );
});

test("a Stopped Claude TUI switches to the web without asking, taking the whole conversation", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeSession("project");
  await app.runCommand(
    app.terminal("session 1"),
    "hello from the start",
    "claude-stub heard: hello from the start",
  );
  killTmuxServer(kbench.instance.config.tmuxSocket);
  await expect(app.sessionStatus("session 1", "stopped")).toBeVisible();

  await app.sessionMenu("session 1", "Open in web");

  await expect(app.page.getByRole("alertdialog")).toHaveCount(0);
  const log = app.agentRegion("session 1").getByRole("log");
  await expect(log).toContainText("claude-stub heard: hello from the start");
  await expect(log.getByRole("article", { name: "In the terminal" })).toHaveCount(1);
});
