import {
  type CanUseTool,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { expect, test } from "vitest";
import { createTestInstance } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";

/** The real Agent SDK, driving the fake Claude Code the way the Agent Runtime will. */
async function openSdk(options: { canUseTool?: CanUseTool } = {}) {
  const instance = createTestInstance();
  const prompts: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  async function* input(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (prompts.length > 0) yield prompts.shift() as SDKUserMessage;
      if (closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  const sdk = query({
    prompt: input(),
    options: {
      pathToClaudeCodeExecutable: instance.config.claudeProgram,
      cwd: instance.makeFolder("work"),
      includePartialMessages: true,
      extraArgs: { "replay-user-messages": null },
      // Not the test run's own environment: it may be inside Claude Code itself.
      env: { PATH: process.env.PATH, HOME: instance.root },
      ...options,
    },
  });
  const messages: SDKMessage[] = [];
  const reading = (async () => {
    for await (const message of sdk) messages.push(message);
  })();
  return {
    instance,
    sdk,
    messages,
    reading,
    send(text: string) {
      prompts.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
      wake?.();
    },
    end() {
      closed = true;
      wake?.();
      sdk.close();
    },
  };
}

const isResult = (m: SDKMessage) => m.type === "result";

test("the SDK gets a scripted session start and streamed reply, and the fake gets the permission answer", async () => {
  const asked: Array<{ tool: string; input: Record<string, unknown> }> = [];
  const session = await openSdk({
    canUseTool: async (tool, input) => {
      asked.push({ tool, input });
      return { behavior: "allow", updatedInput: input };
    },
  });
  const { fakeClaude } = session.instance;
  fakeClaude.configure({
    account: {
      email: "you@example.com",
      subscriptionType: "Claude Max",
      apiProvider: "firstParty",
    },
    version: "2.1.200",
    plugins: [
      { name: "example-plugin", path: "/plugins/example-plugin", version: "1.0.0" },
    ],
  });
  fakeClaude.script([
    { text: ["Let me ", "look."] },
    { tool: { name: "Bash", input: { command: "ls" } }, ask: true, result: "a.txt" },
    { text: "Done." },
  ]);

  session.send("What is here?");
  await pollUntil(() => session.messages.some(isResult), {
    description: "the turn's result",
  });

  const init = session.messages.find((m) => m.type === "system" && m.subtype === "init");
  expect(init).toMatchObject({
    claude_code_version: "2.1.200",
    plugins: [{ name: "example-plugin" }],
  });
  expect(await session.sdk.accountInfo()).toMatchObject({
    subscriptionType: "Claude Max",
  });

  const streamed = session.messages.flatMap((m) =>
    m.type === "stream_event" &&
    m.event.type === "content_block_delta" &&
    m.event.delta.type === "text_delta"
      ? [m.event.delta.text]
      : [],
  );
  expect(streamed).toEqual(["Let me ", "look.", "Done."]);

  expect(asked).toEqual([{ tool: "Bash", input: { command: "ls" } }]);
  const answer = fakeClaude
    .received()
    .find(
      (entry) =>
        entry.kind === "control_response" &&
        "behavior" in (entry.message.response.response as object),
    );
  expect(answer).toMatchObject({
    message: { response: { response: { behavior: "allow" } } },
  });
  const toolResult = session.messages.find(
    (m) => m.type === "user" && JSON.stringify(m.message).includes("tool_result"),
  );
  expect(JSON.stringify(toolResult)).toContain("a.txt");
  expect(session.messages.find(isResult)).toMatchObject({ is_error: false });

  session.end();
  await session.reading;
});

test("an interrupt stops the fake's turn, and closing the SDK ends the fake", async () => {
  const session = await openSdk();
  const { fakeClaude } = session.instance;
  fakeClaude.script([{ text: "Working on it." }, { hold: "never-released" }]);

  session.send("Take your time");
  await pollUntil(() => session.messages.some((m) => m.type === "assistant"), {
    description: "the first reply",
  });
  await session.sdk.interrupt();
  await pollUntil(() => session.messages.some(isResult), {
    description: "the turn to end",
  });
  expect(session.messages.find(isResult)).toMatchObject({
    subtype: "error_during_execution",
    is_error: true,
  });

  const start = fakeClaude.received().find((entry) => entry.kind === "start");
  const pid = start?.kind === "start" ? start.pid : 0;
  expect(pid).toBeGreaterThan(0);
  session.end();
  await session.reading.catch(() => {});
  await pollUntil(
    () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    },
    { description: "the fake to exit" },
  );
});
