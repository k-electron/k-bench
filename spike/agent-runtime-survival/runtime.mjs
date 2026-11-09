// Throwaway spike: a minimal Agent Runtime. Hosts one Agent SDK conversation (streaming input),
// logs every SDKMessage to a file, serves a newline-JSON protocol on a unix socket.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { query } from "@anthropic-ai/claude-agent-sdk";

const [_id, outDir, sockPath] = process.argv.slice(2);
const logFile = `${outDir}/messages.jsonl`;
const history = [];
const clients = new Set();
const envKeys = [
  "PATH",
  "SHELL",
  "LANG",
  "TERM",
  "HOME",
  "USER",
  "TMUX",
  "XPC_SERVICE_NAME",
  "SSH_AUTH_SOCK",
  "LC_ALL",
  "TERM_PROGRAM",
  "PWD",
  "__CF_USER_TEXT_ENCODING",
];
const env = Object.fromEntries(envKeys.map((k) => [k, process.env[k] ?? null]));

function emit(obj) {
  obj = { t: Date.now(), ...obj };
  history.push(obj);
  fs.appendFileSync(logFile, `${JSON.stringify(obj)}\n`);
  for (const c of clients) c.write(`${JSON.stringify(obj)}\n`);
}
function psInfo(pid) {
  try {
    return execFileSync("ps", ["-o", "pid=,ppid=,pgid=,sess=,tty=", "-p", String(pid)])
      .toString()
      .trim();
  } catch {
    return null;
  }
}
function children() {
  try {
    return execFileSync("pgrep", ["-P", String(process.pid)])
      .toString()
      .trim()
      .split("\n");
  } catch {
    return [];
  }
}

// input queue
const queue = [];
let wake = null;
async function* input() {
  for (;;) {
    while (queue.length) yield queue.shift();
    await new Promise((r) => (wake = r));
  }
}
function send(text) {
  queue.push({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  });
  wake?.();
}

emit({
  type: "runtime",
  event: "start",
  pid: process.pid,
  ppid: process.ppid,
  ps: psInfo(process.pid),
  env,
  node: process.version,
});

fs.rmSync(sockPath, { force: true });
const server = net.createServer((c) => {
  clients.add(c);
  c.write(
    `${JSON.stringify({ type: "hello", pid: process.pid, replay: history.length })}\n`,
  );
  for (const h of history) c.write(`${JSON.stringify({ replay: true, ...h })}\n`);
  let buf = "";
  c.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.type === "prompt") send(m.text);
        if (m.type === "ping")
          c.write(
            `${JSON.stringify({ type: "pong", pid: process.pid, claude: children() })}\n`,
          );
      } catch {}
    }
  });
  c.on("close", () => clients.delete(c));
  c.on("error", () => clients.delete(c));
});
server.listen(sockPath);

for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"])
  process.on(sig, () => {
    emit({ type: "runtime", event: "signal", sig });
    process.exit(1);
  });
process.on("exit", (code) => {
  try {
    fs.appendFileSync(
      logFile,
      `${JSON.stringify({ t: Date.now(), type: "runtime", event: "exit", code })}\n`,
    );
  } catch {}
});

const q = query({
  prompt: input(),
  options: {
    model: "haiku",
    cwd: outDir,
    pathToClaudeCodeExecutable: `${process.env.HOME}/.local/bin/claude`,
    allowedTools: ["Bash"],
    settingSources: [],
    stderr: (d) =>
      emit({ type: "runtime", event: "claude-stderr", d: String(d).slice(0, 500) }),
  },
});
(async () => {
  try {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") {
        emit({
          type: "runtime",
          event: "claude-children",
          kids: children().map((p) => psInfo(p)),
        });
      }
      emit({ type: "sdk", m });
    }
    emit({ type: "runtime", event: "query-ended" });
  } catch (e) {
    emit({ type: "runtime", event: "query-error", e: String(e) });
  }
})();
setInterval(() => {}, 1 << 30);
