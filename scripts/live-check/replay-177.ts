// Issue #177 (research branch): judges a redacted recording of the `hooks` scenario with the same
// checks a live run uses, for a run whose turn budget stopped it on its last `result` (the
// checks then say NOT RUN, though every turn finished). Spends nothing.
//
//   node scripts/live-check/replay-177.ts <recordings/hooks.jsonl>
//
// The owner's own hooks' output is a length label in a recording (privacy.ts), so what the
// browser would draw for those hooks is not judged from a replay.
import { readFileSync } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { BLOCK_PROMPT, HOOKS_MODE_CHECKS } from "./hooks-mode.ts";
import type { LiveSession, Msg } from "./session.ts";
import type { Captured, EvalContext } from "./types.ts";

type Event = LiveSession["events"][number];

const file = process.argv[2];
if (!file) throw new Error("usage: replay-177.ts <recordings/hooks.jsonl>");

const sessions: Array<{ msgs: Msg[]; events: Event[]; asks: [] }> = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line) as {
    session?: number;
    dir?: string;
    message?: Msg;
  };
  if (row.session !== undefined) {
    sessions.push({ msgs: [], events: [], asks: [] });
    continue;
  }
  const current = sessions.at(-1);
  const m = row.message;
  if (!current || !m) continue;
  if (row.dir === "in") {
    if (m.type === "user" && typeof m.uuid === "string") {
      const inner = m.message as { content?: unknown } | undefined;
      current.events.push({
        kind: "prompt",
        id: m.uuid,
        text: typeof inner?.content === "string" ? inner.content : "",
      });
    }
    continue;
  }
  if (row.dir !== "out") continue;
  current.msgs.push(m);
  current.events.push({ kind: "message", message: m as unknown as SDKMessage });
}

// The blocked prompt is the third of the first session: its messages start after the second `result`.
const results = (sessions[0]?.msgs ?? []).flatMap((m, i) =>
  m.type === "result" ? [i] : [],
);
const cap: Captured = {
  sessions: sessions as unknown as LiveSession[],
  notes: { blockFrom: (results[1] ?? -1) + 1, blockPrompt: BLOCK_PROMPT },
};
const context = {
  cap,
  all: new Map([["hooks", cap]]),
} as unknown as EvalContext;

for (const check of HOOKS_MODE_CHECKS.filter((c) => c.scenario === "hooks")) {
  const outcome = await check.evaluate(context);
  console.log(`### ${check.name}: ${outcome.verdict} (replayed)\n`);
  console.log(`${check.title}.\n`);
  console.log(`- ${outcome.reason}`);
  console.log(`- assumption in the code: ${check.assumption}`);
  for (const fact of outcome.facts ?? []) console.log(`- ${fact}`);
  console.log("");
}
