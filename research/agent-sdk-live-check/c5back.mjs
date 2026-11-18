// Back to the web: resume the same conversation through the SDK after terminal turns and /compact.
import fs from "node:fs";
import { init, OUT, session, text } from "./lib.mjs";

const { sid } = JSON.parse(fs.readFileSync(`${OUT}/c5-ids.json`, "utf8"));
const s = session("c5-back", {
  resume: sid,
  enableFileCheckpointing: true,
  extraArgs: { "replay-user-messages": null },
});
const r = await s.turn(
  "What codeword and what colour did I ask you to remember? Answer as CODEWORD/COLOUR only.",
);
console.log({
  resumedSid: sid,
  initSid: init(r.msgs).map((m) => m.session_id),
  text: text(r.msgs),
  result: r.result?.subtype,
});
await s.close();
