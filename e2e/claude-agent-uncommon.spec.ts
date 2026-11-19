import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./harness.ts";

// The less common messages, each its own line of the Transcript. Claude Code is the fake from
// test/harness/fake-claude.sh, scripted; the Agent Runtime is the real one. The advisor's frames
// and a hook's response are recorded from a real Claude Code (see the fixture's note); the rest
// are shaped from the SDK's message types.

const recorded = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../test/harness/fixtures/uncommon-messages.json"),
    "utf8",
  ),
) as Record<string, Record<string, unknown>>;

const todo = (content: string, activeForm: string, status: string) => ({
  content,
  activeForm,
  status,
});

test("each less common message is its own line: compaction, hook output, MCP, errors, the advisor, a notice, and one task list that changes in place", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  fakeClaude.configure({
    initFields: {
      mcp_servers: [
        { name: "slack", status: "needs-auth" },
        { name: "calendar", status: "failed" },
        { name: "docs", status: "pending" },
      ],
    },
  });
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const conversation = region.getByRole("log");

  fakeClaude.script([
    // A hook that prints only a terminal escape (a real one, recorded) is not a line.
    { raw: recorded.hookResponseTerminalSequence as Record<string, unknown> },
    {
      system: {
        subtype: "hook_response",
        hook_id: "hook-2",
        hook_name: "PostToolUse:Bash",
        hook_event: "PostToolUse",
        output: "lint: 2 warnings\n",
        stdout: "lint: 2 warnings\n",
        stderr: "",
        exit_code: 0,
        outcome: "success",
      },
    },
    { system: { subtype: "status", status: "compacting" } },
    {
      system: {
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 168000, post_tokens: 12000 },
      },
    },
    { system: { subtype: "status", status: null, compact_result: "success" } },
    {
      system: {
        subtype: "elicitation_complete",
        mcp_server_name: "slack",
        elicitation_id: "e1",
      },
    },
    {
      system: {
        subtype: "informational",
        level: "warning",
        content: "This folder is not trusted: project settings are ignored.",
      },
    },
    { system: { subtype: "informational", level: "info", content: "a quiet banner" } },
    // The advisor, answered with advice Claude Code cannot show (recorded)...
    { raw: recorded.advisorUse as Record<string, unknown> },
    { raw: recorded.advisorRedactedResult as Record<string, unknown> },
    // ...and one whose advice is in the clear.
    {
      raw: {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: "msg_advisor_two",
          role: "assistant",
          content: [
            { type: "server_tool_use", id: "srvtoolu_two", name: "advisor", input: {} },
          ],
        },
      },
    },
    {
      raw: {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: "msg_advisor_two",
          role: "assistant",
          content: [
            {
              type: "advisor_tool_result",
              tool_use_id: "srvtoolu_two",
              content: {
                type: "advisor_result",
                text: "Check the edge cases first.",
                stop_reason: "end_turn",
              },
            },
          ],
        },
      },
    },
    // The task list, written twice: one checklist, with the second list's state.
    {
      tool: {
        name: "TodoWrite",
        input: {
          todos: [
            todo("Read the code", "Reading the code", "in_progress"),
            todo("Fix the bug", "Fixing the bug", "pending"),
          ],
        },
      },
      result: "Todos have been modified successfully.",
    },
    {
      tool: {
        name: "TodoWrite",
        input: {
          todos: [
            todo("Read the code", "Reading the code", "completed"),
            todo("Fix the bug", "Fixing the bug", "in_progress"),
          ],
        },
      },
      result: "Todos have been modified successfully.",
    },
    // A retry that counts up in place, then an error the API ends the turn with.
    {
      system: {
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 2000,
        error_status: 529,
        error: "overloaded",
      },
    },
    {
      system: {
        subtype: "api_retry",
        attempt: 2,
        max_retries: 3,
        retry_delay_ms: 4000,
        error_status: 529,
        error: "overloaded",
      },
    },
    {
      raw: {
        type: "assistant",
        parent_tool_use_id: null,
        error: "server_error",
        message: {
          id: "msg_error",
          role: "assistant",
          content: [{ type: "text", text: "API Error: 500 the server had a problem." }],
        },
      },
    },
    { result: { is_error: true, result: "API Error: 500 the server had a problem." } },
  ]);
  await app.agentInput("session 1").fill("do the thing");
  await app.agentInput("session 1").press("Enter");

  // Hook output: the one with words, not the one with only a terminal escape.
  await expect(
    region.getByRole("article", { name: "Hook PostToolUse:Bash" }),
  ).toContainText("lint: 2 warnings");
  await expect(region.getByRole("article", { name: /^Hook SessionStart/ })).toHaveCount(
    0,
  );

  await expect(
    region.getByRole("article", { name: "Conversation compacted" }),
  ).toContainText("auto, 168k to 12k tokens");

  // MCP: what needs attention, once, and a finished request. `pending` is not news.
  const mcp = region.getByRole("article", { name: "MCP servers" });
  await expect(mcp.getByText("MCP servers need sign-in: slack")).toBeVisible();
  await expect(mcp.getByText("MCP servers failed: calendar")).toBeVisible();
  await expect(mcp.getByText("MCP server slack finished a request")).toBeVisible();
  await expect(conversation).not.toContainText("docs");

  // A warning (where a folder trust warning goes) shows; a plain banner does not.
  await expect(region.getByRole("article", { name: "Warning" })).toContainText(
    "This folder is not trusted: project settings are ignored.",
  );
  await expect(conversation).not.toContainText("a quiet banner");

  // The advisor: a line either way.
  const advisors = region.getByRole("article", { name: "Advisor" });
  await expect(advisors).toHaveCount(2);
  await expect(advisors.nth(0)).toContainText("The advice is encrypted");
  await expect(advisors.nth(1)).toContainText("Check the edge cases first.");

  // Two writes of the task list leave one checklist, in the second's state.
  const tasks = region.getByRole("article", { name: "Task list" });
  await expect(tasks).toHaveCount(1);
  await expect(tasks.getByRole("listitem")).toHaveText([
    /Done: Read the code$/,
    /In progress: Fixing the bug$/,
  ]);
  await expect(tasks).toContainText("1 of 2 done");
  // A task list is not also a tool call with an empty target.
  await expect(region.getByRole("article", { name: /^TodoWrite/ })).toHaveCount(0);

  // The retry is one line that counts; the error, said once by the reply and once by the
  // result, is one line.
  await expect(region.getByRole("article", { name: "Retrying" })).toHaveCount(1);
  await expect(region.getByRole("article", { name: "Retrying" })).toContainText(
    "attempt 2 of 3",
  );
  const errors = region.getByRole("article", { name: "Error" });
  await expect(errors).toHaveCount(1);
  await expect(errors).toContainText("API Error: 500 the server had a problem.");
  // The reply that carried the error is not also shown as Claude's prose.
  await expect(region.getByRole("article", { name: "Claude", exact: true })).toHaveCount(
    0,
  );
});

test("a usage limit is shown plainly once, and an interrupt is not an error", async ({
  app,
  kbench,
}) => {
  const { fakeClaude } = kbench.instance;
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const conversation = region.getByRole("log");
  const input = app.agentInput("session 1");

  // The first turn of a Session always carries a rate limit event that says all is well: no line.
  fakeClaude.script([
    {
      raw: {
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
      },
    },
    {
      raw: {
        type: "assistant",
        parent_tool_use_id: null,
        error: "rate_limit",
        message: {
          id: "msg_limit",
          role: "assistant",
          content: [{ type: "text", text: "You've hit your limit · resets 3pm" }],
        },
      },
    },
    { result: { is_error: true, result: "You've hit your limit · resets 3pm" } },
  ]);
  await input.fill("one more");
  await input.press("Enter");
  const limit = region.getByRole("article", { name: "Usage limit" });
  await expect(limit).toHaveCount(1);
  await expect(limit).toContainText("You've hit your limit · resets 3pm");
  await expect(region.getByRole("article", { name: "Error" })).toHaveCount(0);

  // Interrupting ends the turn with an error result; that is not an error line.
  fakeClaude.script([
    { text: "running it" },
    { tool: { name: "Bash", input: { command: "sleep 99" } }, hold: "never" },
  ]);
  await input.fill("a long job");
  await input.press("Enter");
  await expect(conversation).toContainText("running it");
  await region.getByRole("button", { name: "Interrupt" }).click();
  await expect(conversation.getByText("Interrupted")).toHaveCount(1);
  await expect(region.getByRole("article", { name: "Error" })).toHaveCount(0);
  await expect(limit).toHaveCount(1);
});
