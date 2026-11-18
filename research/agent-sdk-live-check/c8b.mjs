// Does /goal keep the session going across turns until the condition holds?
import fs from "node:fs";
import { session, WORK } from "./lib.mjs";

try {
  fs.unlinkSync(`${WORK}/count.txt`);
} catch {}
const s = session("c8b-goal-multi", { permissionMode: "acceptEdits" });
s.send(
  "/goal count.txt in the working directory has three lines: 1, 2, 3. Work rule: in each turn add exactly ONE line (the next number) with a single tool call, then end your turn immediately without checking the goal.",
);
const t0 = Date.now();
let results = 0;
while (Date.now() - t0 < 240_000) {
  const r = await s.next((m) => m.type === "result", 60_000, s.msgs.length);
  if (!r) break;
  results++;
  console.log(
    `result ${results} at ${Math.round((Date.now() - t0) / 1000)}s:`,
    (r.result || "").slice(0, 120).replace(/\n/g, " "),
    "| file:",
    JSON.stringify(
      fs.existsSync(`${WORK}/count.txt`)
        ? fs.readFileSync(`${WORK}/count.txt`, "utf8")
        : null,
    ),
  );
}
const kinds = [...new Set(s.msgs.map((m) => `${m.type}/${m.subtype ?? ""}`))];
console.log({ results, kinds });
console.log(
  s.msgs
    .filter(
      (m) =>
        (m.type === "user" && typeof m.message.content === "string") ||
        (m.type === "user" && m.message.content.some?.((b) => b.type === "text")),
    )
    .map((m) => JSON.stringify(m.message.content).slice(0, 200)),
);
await s.close();
