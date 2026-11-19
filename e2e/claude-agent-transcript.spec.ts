import { join } from "node:path";
import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh, scripted to take one turn that shows
// every kind of thing the Transcript has; nothing here runs the real `claude`, and the Agent
// Runtime is the real one.

const OUTPUT = Array.from({ length: 12 }, (_, i) => `file-${i + 1}.txt`).join("\n");

test("a turn reads like Claude TUI: the prompt, thinking, prose, tool calls with their output and diffs, a status line while it works, and the header", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  fakeClaude.configure({ version: "9.8.7", model: "fake-model" });
  const folder = kbench.instance.makeFolder("project");
  await app.createWorkspace(folder);
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const header = region.getByRole("note", { name: "Claude Code" });

  // Before the first prompt Claude Code has not named its model: the header has what is known.
  await expect(header).toContainText(`claude 9.8.7 · ${folder}`);
  await expect(header).not.toContainText("fake-model");

  fakeClaude.script([
    { thinking: true },
    { text: "**Plan:** look around, then fix it.\n\n- list the files\n- edit one" },
    { tool: { name: "Bash", input: { command: "ls -la" } }, result: OUTPUT },
    {
      tool: {
        name: "Edit",
        input: {
          file_path: join(folder, "hello.txt"),
          old_string: "old line",
          new_string: "new line",
        },
      },
      result: "The file has been updated.",
    },
    { tool: { name: "Bash", input: { command: "rm -rf build" } }, ask: true },
    // A tool call that never gets a result: the turn ends with it still running.
    {
      raw: {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: "msg_orphan",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_orphan",
              name: "Bash",
              input: { command: "sleep 99" },
            },
          ],
        },
      },
    },
    { hold: "finish" },
    { text: "all done" },
  ]);
  await app.agentInput("session 1").fill("tidy the project");
  await app.agentInput("session 1").press("Enter");

  const prompt = region.getByRole("article", { name: "Your prompt" });
  await expect(prompt).toContainText("tidy the project");

  // While Claude waits on the permission the status line says so and for how long, and the
  // tool call is a spinner.
  const rm = region.getByRole("article", { name: "Bash(rm -rf build)", exact: true });
  await expect(rm.getByRole("img", { name: "Running" })).toBeVisible();
  const working = region.getByRole("status", { name: "Claude status" });
  await expect(working).toContainText("Waiting for you");
  await expect(working).toContainText(/\(\d+s\)/);
  await expect(header).toContainText(`claude 9.8.7 · fake-model · ${folder}`);

  const panel = app.permissionPrompt("session 1");
  await panel.getByRole("button", { name: /^\d\. No, and tell Claude/ }).click();
  await panel.getByRole("button", { name: "Deny without a reply" }).click();
  await expect(rm.getByRole("img", { name: "Denied" })).toBeVisible();

  // The turn is held open with the last call still running.
  const sleep = region.getByRole("article", { name: "Bash(sleep 99)", exact: true });
  await expect(sleep.getByRole("img", { name: "Running" })).toBeVisible();
  await expect(working).toContainText("Running Bash…");
  fakeClaude.release("finish");

  await expect(region.getByRole("log")).toContainText("all done");
  // The line goes when the turn ends; the context left stays.
  await expect(working).toHaveCount(0);
  // The fake's Claude Code reports 20000 tokens of the 160000 at which it compacts.
  await expect(region.getByRole("note", { name: "Context left" })).toContainText(
    "Context left until auto-compact: 88%",
  );

  // Thinking is one muted line with how long it took.
  await expect(region.getByRole("article", { name: "Thinking" })).toContainText(
    "Thought for 1s",
  );

  // Prose is real markdown: a list, not asterisks and dashes.
  const prose = region.getByRole("article", { name: "Claude" }).first();
  await expect(prose.getByRole("listitem")).toHaveText(["list the files", "edit one"]);
  await expect(prose).not.toContainText("**");

  // Long output is collapsed to five lines and opens on tap.
  const ls = region.getByRole("article", { name: "Bash(ls -la)", exact: true });
  await expect(ls.getByText("file-5.txt")).toBeVisible();
  await expect(ls.getByText("file-6.txt")).toHaveCount(0);
  await ls.getByRole("button", { name: "+7 lines, tap to expand" }).click();
  await expect(ls.getByText("file-12.txt")).toBeVisible();
  await ls.getByRole("button", { name: "Show fewer lines" }).click();
  await expect(ls.getByText("file-12.txt")).toHaveCount(0);

  // An edit shows its change as coloured lines, with its path relative to the folder.
  const edit = region.getByRole("article", { name: "Edit(hello.txt)", exact: true });
  await expect(edit).toContainText("Updated hello.txt with 1 addition and 1 removal");
  const removed = edit.getByRole("deletion");
  const added = edit.getByRole("insertion");
  await expect(removed).toHaveText(/^-\s*old line$/);
  await expect(added).toHaveText(/^\+\s*new line$/);
  const style = (element: typeof added, property: "color" | "backgroundColor") =>
    element.evaluate((el, name) => {
      // This runs in the page; the e2e project's types have no DOM.
      const page = globalThis as unknown as {
        getComputedStyle(el: unknown): Record<string, string>;
      };
      return page.getComputedStyle(el)[name] as string;
    }, property);
  expect(await style(removed, "backgroundColor")).not.toBe("rgba(0, 0, 0, 0)");
  expect(await style(added, "backgroundColor")).not.toBe("rgba(0, 0, 0, 0)");
  expect(await style(removed, "backgroundColor")).not.toBe(
    await style(added, "backgroundColor"),
  );
  expect(await style(removed, "color")).not.toBe(await style(added, "color"));

  // Green when done, red when denied or interrupted (the call that never got a result).
  const colourOf = (call: typeof ls, state: string) =>
    style(call.getByRole("img", { name: state }), "color");
  const done = await colourOf(ls, "Done");
  const denied = await colourOf(rm, "Denied");
  const interrupted = await colourOf(sleep, "Interrupted");
  expect(done).not.toBe(denied);
  expect(interrupted).toBe(denied);
});
