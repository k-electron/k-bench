import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/shared/agent-protocol.ts";

// The browser's modules are written for Vite (extension-less imports), which `tsc` does not
// check under the server's settings: load by path and name what is read of it.
const WEB_ITEMS = join(import.meta.dirname, "..", "web", "src", "agent", "items.ts");
const { buildItems } = (await import(/* @vite-ignore */ WEB_ITEMS)) as {
  buildItems(entries: readonly LogEntry[]): {
    items: Array<{ kind: string; [field: string]: unknown }>;
  };
};

// What the Transcript shows for messages as the live check recorded them from a real Claude Code
// (#161; names and ids made up): a typed command's reply is an assistant message of model
// `<synthetic>` carrying the output as `local_command_source`, and the command is echoed back as
// its own markup.

let seq = 0;
const sdk = (message: Record<string, unknown>): LogEntry => ({
  seq: ++seq,
  t: "2026-01-01T00:00:00Z",
  kind: "sdk",
  message,
});
const prompt = (id: string, text: string): LogEntry => ({
  seq: ++seq,
  t: "2026-01-01T00:00:00Z",
  kind: "prompt",
  id,
  text,
});

const syntheticReply = (output: string) =>
  sdk({
    type: "assistant",
    message: {
      model: "<synthetic>",
      role: "assistant",
      content: [{ type: "text", text: output }],
    },
    parent_tool_use_id: null,
    local_command_source: `<local-command-stdout>${output}</local-command-stdout>`,
  });

const commandEcho = (uuid: string, name: string, args: string) =>
  sdk({
    type: "user",
    message: {
      role: "user",
      content: `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`,
    },
    parent_tool_use_id: null,
    uuid,
    isReplay: true,
  });

describe("a typed command in the Transcript", () => {
  it("shows its reply as a command output line, and its echo as no second prompt", () => {
    const { items } = buildItems([
      prompt("p1", "/model haiku"),
      sdk({ type: "system", subtype: "init", model: "claude-haiku-5-5", cwd: "/work" }),
      syntheticReply("Set model to `Haiku 5.5` for this session only"),
      commandEcho("p1", "model", "haiku"),
      sdk({ type: "result", subtype: "success" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["prompt", "command_output"]);
    expect(items[1]).toMatchObject({
      text: "Set model to `Haiku 5.5` for this session only",
    });
  });

  it("shows a reply saying the command isn't available as one Unsupported row, not also as text", () => {
    const { items } = buildItems([
      prompt("p2", "/plugin"),
      syntheticReply("/plugin isn't available in this environment."),
      sdk({ type: "result", subtype: "success" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["prompt", "unsupported"]);
  });

  it("reads a command typed in a terminal, as the saved conversation holds it, as the command and its output", () => {
    const { items } = buildItems([
      sdk({
        type: "user",
        isReplay: true,
        uuid: "t1",
        message: {
          role: "user",
          content:
            "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>",
        },
      }),
      sdk({
        type: "user",
        isReplay: true,
        uuid: "t2",
        message: {
          role: "user",
          content: "<local-command-stdout>Set model to Sonnet</local-command-stdout>",
        },
      }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["prompt", "command_output"]);
    expect(items[0]).toMatchObject({ text: "/model sonnet" });
    expect(items[1]).toMatchObject({ text: "Set model to Sonnet" });
  });
});
