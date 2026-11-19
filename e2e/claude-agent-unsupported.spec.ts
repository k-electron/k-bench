import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh: nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

test("what Claude Code says that k-bench can't show or answer becomes an Unsupported row where it happened, opens the raw view and raises no Bell", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const conversation = region.getByRole("log");
  const unsupported = conversation.getByRole("article", { name: "Unsupported" });
  const send = async (text: string) => {
    await app.agentInput("session 1").fill(text);
    await app.agentInput("session 1").press("Enter");
  };

  // An ordinary turn, with everything Claude Code sends around it (status, rate limits, session
  // state), shows no Unsupported row: only what k-bench does not know does.
  await send("hello");
  await expect(conversation).toContainText("fake claude heard: hello");
  await expect(unsupported).toHaveCount(0);

  // A message of a kind nobody has heard of, a request k-bench declines, and a command that
  // answers "isn't available": each is a row, in the order they happened.
  kbench.instance.fakeClaude.script([
    { text: "Trying a few things." },
    { raw: { type: "mystery_kind", payload: { n: 42 } } },
    { elicit: { serverName: "docs", message: "Which workspace should I use?" } },
    {
      system: {
        subtype: "local_command_output",
        content: "/plugin isn't available in this environment.",
      },
    },
    { text: "That is all." },
  ]);
  await send("try things");
  await expect(conversation).toContainText("That is all.");

  await expect(unsupported).toHaveCount(3);
  await expect(unsupported.nth(0)).toContainText('"mystery_kind"');
  await expect(unsupported.nth(1)).toContainText(
    'The MCP server "docs" asked you: "Which workspace should I use?"',
  );
  await expect(unsupported.nth(2)).toContainText("/plugin isn't available");

  // The row opens the raw view of the message it is about.
  await unsupported.nth(0).getByRole("button", { name: "Open raw view" }).click();
  const raw = conversation.getByLabel("Raw message", { exact: true });
  await expect(raw).toBeVisible();
  expect(JSON.parse((await raw.textContent()) ?? "")).toMatchObject({
    type: "mystery_kind",
    payload: { n: 42 },
  });

  // None of it raised the Bell.
  await expect(app.sessionStatus("session 1", "idle")).toBeVisible();
  await expect(app.rowPulse("session 1")).toHaveCount(0);
});
