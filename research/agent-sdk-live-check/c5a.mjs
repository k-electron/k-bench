// Check 5, step A: web turns with client-set uuids and checkpointing on.
import crypto from "node:crypto";
import fs from "node:fs";
import { OUT, session, text } from "./lib.mjs";

const U1 = crypto.randomUUID(),
  U2 = crypto.randomUUID();
const s = session("c5a-web", {
  permissionMode: "acceptEdits",
  enableFileCheckpointing: true,
  extraArgs: { "replay-user-messages": null },
});
const a = await s.turn(
  "Use the Write tool to create story.txt containing the single line: web one. Then reply DONE.",
  { uuid: U1 },
);
const b = await s.turn("Remember the codeword ALBATROSS for later. Reply only OK.", {
  uuid: U2,
});
const sid = s.msgs.find((m) => m.session_id)?.session_id;
const replayed = s.msgs.filter((m) => m.type === "user" && m.isReplay).map((m) => m.uuid);
console.log({
  sid,
  U1,
  U2,
  replayedUuids: replayed,
  a: text(a.msgs),
  b: text(b.msgs),
  file: fs.readFileSync("../work/story.txt", "utf8"),
});
fs.writeFileSync(`${OUT}/c5-ids.json`, JSON.stringify({ sid, U1, U2 }));
await s.close();
