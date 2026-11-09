// usage: client.mjs <sock> <waitMs> [prompt]  -> prints compact events, exits after waitMs or on result
import net from "node:net";

const [sock, waitMs, prompt] = process.argv.slice(2);
const c = net.connect(sock);
let buf = "",
  _gotResult = false;
c.on("error", (e) => {
  console.log("CONNECT-ERR", e.code);
  process.exit(2);
});
c.on("connect", () => {
  if (prompt) c.write(`${JSON.stringify({ type: "prompt", text: prompt })}\n`);
  c.write(`${JSON.stringify({ type: "ping" })}\n`);
});
c.on("data", (d) => {
  buf += d;
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const m = JSON.parse(l);
    const tag = m.replay ? "R" : "L";
    if (m.type === "sdk") {
      console.log(
        tag,
        m.m.type,
        m.m.subtype ?? "",
        m.m.type === "result"
          ? JSON.stringify({ r: m.m.result, cost: m.m.total_cost_usd })
          : "",
      );
      if (m.m.type === "result") {
        _gotResult = true;
        if (waitMs === "result") {
          c.end();
          setTimeout(() => process.exit(0), 100);
        }
      }
    } else
      console.log(
        tag,
        m.type,
        m.event ?? "",
        m.type === "pong" || m.type === "hello" ? JSON.stringify(m) : "",
      );
  }
});
if (waitMs !== "result") setTimeout(() => process.exit(0), +waitMs);
