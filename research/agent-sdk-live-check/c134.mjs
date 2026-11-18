// Checks 1 (plugins), 3 (focus view), 4 (advisor).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { init, session, text, toolUses } from "./lib.mjs";

const SETTINGS = `${os.homedir()}/.claude/settings.json`;
const hash = () =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(SETTINGS))
    .digest("hex")
    .slice(0, 12);
const before = hash();

const ASK =
  "Is a tool named exactly 'advisor' available to you right now? Answer only yes or no.";

async function run(name, options, prompts = [ASK]) {
  const s = session(name, options);
  const out = { name };
  for (const p of prompts) {
    const { result, msgs } = await s.turn(p);
    const i = init(msgs).at(-1);
    out.init ??= i && {
      plugins: i.plugins?.map((p) => p.name),
      plugin_errors: i.plugin_errors,
      view_mode: i.view_mode,
      model: i.model,
      claude_code_version: i.claude_code_version,
      advisorish_tools: i.tools.filter((t) => /advis/i.test(t)),
      tool_count: i.tools.length,
      betas: i.betas,
      capabilities: i.capabilities,
    };
    out.turns ??= [];
    out.turns.push({
      prompt: p.slice(0, 60),
      text: text(msgs).slice(0, 300),
      tools: toolUses(msgs),
      result: result && {
        subtype: result.subtype,
        is_error: result.is_error,
        cost: result.total_cost_usd,
        models: Object.keys(result.modelUsage ?? {}),
      },
      nonstandard: [...new Set(msgs.map((m) => `${m.type}/${m.subtype ?? ""}`))],
    });
  }
  await s.close();
  console.log(JSON.stringify(out, null, 1));
}

await run("c1-baseline", {});
await run("c3-c4-settings", { settings: { viewMode: "focus", advisorModel: "opus" } });
await run("c4-extraArgs", { extraArgs: { advisor: "opus" } }, [
  ASK,
  "Consult your advisor tool once (a single call), then tell me in one word: is 2+2 equal to 4?",
]);
await run("c4-extraArgs-disabled", {
  extraArgs: { advisor: "opus" },
  env: { ...process.env, CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" },
});
console.log("user settings unchanged:", before === hash(), before, hash());
