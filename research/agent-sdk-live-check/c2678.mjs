// Checks 2 (plan approval), 6 (/clear), 7 (@path), 8 (/goal, /loop).
import fs from "node:fs";
import { init, session, text, toolUses, WORK } from "./lib.mjs";

const which = process.argv[2];
const sid = (ms) => [...new Set(ms.map((m) => m.session_id).filter(Boolean))];
const types = (ms) => [...new Set(ms.map((m) => `${m.type}/${m.subtype ?? ""}`))];

if (which === "2") {
  const asked = [];
  const s = session("c2-plan", {
    permissionMode: "plan",
    canUseTool: async (toolName, input) => {
      asked.push({ toolName, input: JSON.stringify(input).slice(0, 300) });
      return { behavior: "allow", updatedInput: input };
    },
  });
  const r = await s.turn(
    "Plan this, then ask me to approve the plan: create a file plan-check.txt containing the single word approved. Keep the plan to one line.",
  );
  console.log({
    asked,
    tools: toolUses(r.msgs),
    text: text(r.msgs).slice(0, 400),
    types: types(r.msgs),
    result: r.result?.subtype,
  });
  console.log(
    "permissionMode after:",
    init(s.msgs).map((m) => m.permissionMode),
    "file exists:",
    fs.existsSync(`${WORK}/plan-check.txt`),
  );
  await s.close();
}

if (which === "6") {
  const s = session("c6-clear", {});
  const a = await s.turn("Remember the word PELICAN. Reply only OK.");
  const b = await s.turn("/clear");
  const c = await s.turn(
    "What word did I ask you to remember? If you don't know, reply only UNKNOWN.",
  );
  for (const [n, t] of Object.entries({ a, b, c }))
    console.log(n, {
      sid: sid(t.msgs),
      types: types(t.msgs),
      text: text(t.msgs).slice(0, 200),
      result: t.result?.subtype,
      resultText: t.result?.result?.slice?.(0, 200),
    });
  await s.close();
}

if (which === "7") {
  fs.writeFileSync(`${WORK}/note.txt`, "The secret fruit is QUINCE.\n");
  const asked = [];
  const s = session("c7-atpath", {
    canUseTool: async (toolName) => {
      asked.push(toolName);
      return { behavior: "deny", message: "no tools in this check" };
    },
    disallowedTools: ["Read", "Bash", "Glob", "Grep"],
  });
  const r = await s.turn(
    "What is the secret fruit in @note.txt? Do not use any tools. Reply with just the fruit, or NOFILE if you can't see the file.",
  );
  const userEcho = r.msgs
    .filter((m) => m.type === "user")
    .map((m) => JSON.stringify(m.message.content).slice(0, 300));
  console.log({
    asked,
    tools: toolUses(r.msgs),
    text: text(r.msgs),
    types: types(r.msgs),
    userEcho,
  });
  await s.close();
}

if (which === "8") {
  const s = session("c8-goal-loop", {});
  const g = await s.turn("/goal reply with the word GOALDONE once, then you are done");
  console.log("goal", {
    types: types(g.msgs),
    text: text(g.msgs).slice(0, 300),
    result: g.result?.subtype,
    resultText: g.result?.result?.slice?.(0, 300),
  });
  // see whether goal keeps going on its own
  const more = await s.next((m) => m.type === "result", 45_000, s.msgs.length);
  console.log("goal follow-on result within 45s:", !!more);

  const from = s.msgs.length;
  const l = await s.turn("/loop 1m reply with only the word TICK");
  console.log("loop first", {
    types: types(l.msgs),
    text: text(l.msgs).slice(0, 300),
    resultText: l.result?.result?.slice?.(0, 300),
  });
  const t0 = Date.now();
  const second = await s.next((m) => m.type === "result", 200_000, s.msgs.length);
  console.log(
    "loop fired again on its own:",
    !!second,
    `${Math.round((Date.now() - t0) / 1000)}s`,
    second && text(s.msgs.slice(from)).slice(-200),
  );
  await s.close();
}
