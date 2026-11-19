// What the fake Claude Code saves of a conversation, in a Claude Code folder of the test's own
// (`claude-config`, beside the fake), so that Open in web's import has something to read: the
// Agent SDK's `getSessionMessages` parses these files. It is the format Claude Code keeps, cut
// to what that function reads: `<config>/projects/<folder with every character but letters
// and digits as "-">/<conversation ID>.jsonl`, one JSON per line, each message pointing at the
// one before it with `parentUuid`. A compaction starts a new chain: a `compact_boundary`
// (no parent) and the summary under it, and everything after hangs from the summary.
// Plain JavaScript with no imports beyond Node's, because both fakes run it under the `node`
// linked beside them, outside Vitest. Used as a module by `fake-claude-sdk.mjs` and as a
// program by `fake-claude.sh`:
//   node fake-claude-session.mjs <config folder> <conversation ID> turn <text>
//   node fake-claude-session.mjs <config folder> <conversation ID> compact
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The conversation's file, for the folder Claude Code runs in (`cwd`, as the OS gives it). */
export function sessionFile(configDir, conversationId, cwd = process.cwd()) {
  return join(
    configDir,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${conversationId}.jsonl`,
  );
}

function lastUuid(file) {
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    return JSON.parse(lines[lines.length - 1]).uuid ?? null;
  } catch {
    return null;
  }
}

/** Appends one message to the conversation, chained to the one before it. */
export function appendMessage(configDir, conversationId, message, { parent } = {}) {
  const file = sessionFile(configDir, conversationId);
  mkdirSync(join(file, ".."), { recursive: true });
  const entry = {
    parentUuid: parent === undefined ? lastUuid(file) : parent,
    isSidechain: false,
    userType: "external",
    cwd: process.cwd(),
    sessionId: conversationId,
    version: "2.1.0",
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    ...message,
  };
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return entry;
}

export const userMessage = (content, extra = {}) => ({
  type: "user",
  message: { role: "user", content },
  ...extra,
});

export const assistantMessage = (content, extra = {}) => ({
  type: "assistant",
  message: {
    id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    model: "fake-model",
    content,
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  ...extra,
});

/** `/compact`: the chain starts again at a summary. */
export function compact(configDir, conversationId) {
  const before = lastUuid(sessionFile(configDir, conversationId));
  const boundary = appendMessage(
    configDir,
    conversationId,
    {
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      level: "info",
      logicalParentUuid: before,
      compactMetadata: { trigger: "manual", preTokens: 1000 },
    },
    { parent: null },
  );
  appendMessage(
    configDir,
    conversationId,
    userMessage(
      "This session is being continued from a previous conversation. Summary: fake.",
      {
        isCompactSummary: true,
      },
    ),
    { parent: boundary.uuid },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [configDir, conversationId, command, text] = process.argv.slice(2);
  if (command === "turn") {
    appendMessage(configDir, conversationId, userMessage(text));
    appendMessage(
      configDir,
      conversationId,
      assistantMessage([{ type: "text", text: `claude-stub heard: ${text}` }]),
    );
  } else if (command === "compact") {
    compact(configDir, conversationId);
  } else if (command === "denied") {
    // A permission denied with a reply, as Claude Code saves the tool's result (recorded by the
    // live check, #161).
    appendMessage(configDir, conversationId, {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_stub",
            is_error: true,
            content: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n${text}`,
          },
        ],
      },
    });
  }
}
