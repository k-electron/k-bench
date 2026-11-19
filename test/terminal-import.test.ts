import { describe, expect, it } from "vitest";
import {
  COMPACTED_IN_THE_TERMINAL,
  planTerminalImport,
  type SavedMessage,
} from "../src/agent-runtime/terminal-import.ts";
import type { LogEntry } from "../src/shared/agent-protocol.ts";

// A terminal's `/compact`, as the live check saw the chain `getSessionMessages` returns for it
// (#161; kinds only, texts made up): it starts with a system message, then the summary marked
// `isCompactSummary` and `is_meta`, and ends with the command's own output marked
// `isCompletedLocalCommand`. The prompts k-bench sent are still in it, so the import is anchored
// on them (the "found" path), and the compaction must still be said.

const saved = (
  type: SavedMessage["type"],
  uuid: string,
  content: unknown,
  flags: Partial<SavedMessage> = {},
): SavedMessage => ({
  type,
  uuid,
  session_id: "s",
  message: { role: type === "assistant" ? "assistant" : "user", content },
  parent_tool_use_id: null,
  ...flags,
});

const log: LogEntry[] = [
  { seq: 1, t: "t", kind: "prompt", id: "web-prompt", text: "hello" },
  {
    seq: 2,
    t: "t",
    kind: "sdk",
    message: { type: "assistant", uuid: "web-reply", message: { content: [] } },
  },
];

describe("importing what a terminal did, after it compacted", () => {
  it("says the terminal compacted, shows the summary as Claude's own and not as a prompt, and shows nothing twice", () => {
    const chain: SavedMessage[] = [
      saved("system", "boundary", undefined),
      saved("user", "summary", "SUMMARY TEXT", { isCompactSummary: true, is_meta: true }),
      saved("user", "web-prompt", "hello"),
      saved("assistant", "web-reply", [{ type: "text", text: "hi" }]),
      saved("user", "command-echo", "<local-command-caveat>x</local-command-caveat>", {
        isCompletedLocalCommand: true,
      }),
      saved(
        "user",
        "command-output",
        "<local-command-stdout>Compacted</local-command-stdout>",
        {
          isCompletedLocalCommand: true,
        },
      ),
    ];
    const entries = planTerminalImport(log, chain);

    expect(entries[0]).toEqual({ kind: "divider", label: COMPACTED_IN_THE_TERMINAL });
    expect(entries.at(-1)).toMatchObject({ kind: "divider", label: "Back in web" });
    const imported = entries.flatMap((entry) =>
      entry.kind === "sdk" ? [entry.message] : [],
    );
    expect(imported.map((m) => m.uuid)).toEqual([
      "summary",
      "command-echo",
      "command-output",
    ]);
    const summary = imported[0] as Record<string, unknown>;
    expect(summary.isCompactSummary).toBe(true);
    expect(summary.isReplay).toBeUndefined();
    // What Claude Code wrote itself is never something the owner typed.
    for (const message of imported) expect(message.isReplay).toBeUndefined();
  });

  it("imports the summary when it comes after the anchor too", () => {
    const chain: SavedMessage[] = [
      saved("user", "web-prompt", "hello"),
      saved("assistant", "web-reply", [{ type: "text", text: "hi" }]),
      saved("system", "boundary", undefined),
      saved("user", "summary", "SUMMARY TEXT", { isCompactSummary: true, is_meta: true }),
      saved("user", "typed", "after compacting"),
    ];
    const entries = planTerminalImport(log, chain);
    expect(entries[0]).toEqual({ kind: "divider", label: COMPACTED_IN_THE_TERMINAL });
    const imported = entries.flatMap((entry) =>
      entry.kind === "sdk" ? [entry.message] : [],
    );
    expect(
      imported.map((m) => [m.uuid, m.isCompactSummary === true, m.isReplay === true]),
    ).toEqual([
      ["summary", true, false],
      ["typed", false, true],
    ]);
  });
});
