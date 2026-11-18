// After terminal turns: find the client-set uuid in getSessionMessages and list what follows.
import fs from "node:fs";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { OUT, WORK } from "./lib.mjs";

const { sid, U1, U2 } = JSON.parse(fs.readFileSync(`${OUT}/c5-ids.json`, "utf8"));
const msgs = await getSessionMessages(sid, { dir: WORK });
const brief = (m) => {
  const c = m.message?.content;
  const t =
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c
            .map((b) =>
              b.type === "text" ? b.text : `[${b.type}${b.name ? `:${b.name}` : ""}]`,
            )
            .join(" ")
        : JSON.stringify(m).slice(0, 80);
  return `${m.type.padEnd(9)} ${m.uuid?.slice(0, 8)} ${t.replace(/\n/g, " ").slice(0, 90)}`;
};
console.log(
  "count",
  msgs.length,
  "| U1 at",
  msgs.findIndex((m) => m.uuid === U1),
  "| U2 at",
  msgs.findIndex((m) => m.uuid === U2),
);
const i = msgs.findIndex((m) => m.uuid === U2);
console.log("keys of one entry:", Object.keys(msgs[0]));
for (const m of msgs.slice(Math.max(0, i))) console.log(brief(m));
