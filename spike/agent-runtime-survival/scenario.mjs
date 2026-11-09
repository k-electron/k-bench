// usage: scenario.mjs <strategy> <restart> <abandon:1|0>

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const [strategy, restart, abandon] = process.argv.slice(2);
const SPIKE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const id = `${strategy}-${restart}-${abandon === "1" ? "abp" : "noabp"}`;
const out = `${SPIKE}/out/${id}`;
const sock = `/tmp/kbs/${id}.sock`;
const app = `${out}/app`;
const uid = process.getuid();
const label = `com.k-bench.spike-parent-${id}`;
const plist = `${out}/parent.plist`;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
const rec = {};
const log = (k, v) => {
  rec[k] = v;
  fs.writeFileSync(`${out}/result.json`, JSON.stringify(rec, null, 2));
  console.log(id, k, typeof v === "string" ? v : JSON.stringify(v));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return (r.stdout + r.stderr).trim();
};
const ps = () =>
  run("ps", ["-axo", "pid,ppid,pgid,sess,command"])
    .split("\n")
    .filter(
      (l) =>
        l.includes(id) ||
        (/claude.*(stream-json|input-format)/.test(l) && l.includes(out)),
    )
    .map((l) =>
      l
        .replace(/\s+/g, " ")
        .replace(/\/Users\/[^ ]*\/scratchpad\/spike/g, "$SPIKE")
        .slice(0, 200),
    );
const sockLive = () => run("node", [`${SPIKE}/client.mjs`, sock, "1500"]);

function writeParent() {
  fs.writeFileSync(`${app}/parent.mjs`, fs.readFileSync(`${SPIKE}/parent.mjs`));
  fs.writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${app}/parent.mjs</string><string>${id}</string><string>${strategy}</string><string>${out}</string><string>${sock}</string><string>${SPIKE}</string></array>
<key>WorkingDirectory</key><string>${app}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string><key>HOME</key><string>${process.env.HOME}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
${abandon === "1" ? "<key>AbandonProcessGroup</key><true/>" : ""}
<key>StandardOutPath</key><string>${out}/parent.out</string><key>StandardErrorPath</key><string>${out}/parent.out</string>
</dict></plist>`,
  );
}
const parentPid = () => {
  const m = run("launchctl", ["print", `gui/${uid}/${label}`]).match(/\bpid = (\d+)/);
  return m ? +m[1] : null;
};

writeParent();
log("bootstrap", run("launchctl", ["bootstrap", `gui/${uid}`, plist]) || "ok");
for (let i = 0; i < 40 && !fs.existsSync(sock); i++) await sleep(500);
log("runtime-up", fs.existsSync(sock));
const parent0 = parentPid();
await sleep(1000);
// send the prompt via a client that stays connected ~ until the Bash tool_use appears
const prompt =
  "Run this exact Bash command, then reply with the single word finished: echo PATH=$PATH; which node claude pnpm; sleep 75; echo SPIKE_DONE";
const c1 = spawnSync("node", [`${SPIKE}/client.mjs`, sock, "12000", prompt], {
  encoding: "utf8",
});
log("client1", c1.stdout.trim().split("\n").slice(-6));
const pre = ps();
log("ps-before", pre);
const rtPid0 = (/"pid":(\d+)/.exec(c1.stdout) || [])[1];
const kids0 = rtPid0 ? run("pgrep", ["-P", rtPid0]).split("\n") : [];
log("rt-pid-before", { rtPid0, claudeChildren: kids0, parent0 });
log("restart-at", new Date().toISOString());
if (restart === "bootoutswap") {
  log("bootout", run("launchctl", ["bootout", `gui/${uid}/${label}`]) || "ok");
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(app);
  writeParent();
  await sleep(2000);
  log("bootstrap2", run("launchctl", ["bootstrap", `gui/${uid}`, plist]) || "ok");
} else if (restart === "kickstart") {
  log("kickstart", run("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`]) || "ok");
} else if (restart === "kill9") {
  process.kill(parent0, "SIGKILL");
  log("kill9", `killed ${parent0}`);
} else if (restart === "killrt") {
  process.kill(+rtPid0, "SIGKILL");
  log("killrt", `killed runtime ${rtPid0}`);
}
await sleep(8000);
log("parent-after", {
  pid: parentPid(),
  log: fs
    .readFileSync(`${out}/parent.log`, "utf8")
    .trim()
    .split("\n")
    .map((l) => l.replace(/^\S+ /, ""))
    .slice(-4),
});
log("ps-after", ps());
const alive = (p) => {
  try {
    process.kill(+p, 0);
    return true;
  } catch {
    return false;
  }
};
log(
  "claude-child-ps",
  kids0.map((p) =>
    run("ps", ["-o", "pid=,ppid=,pgid=,stat=,command=", "-p", p]).slice(0, 90),
  ),
);
log("survival", {
  runtime: rtPid0 ? alive(rtPid0) : null,
  claude: kids0.map((p) => [p, alive(p)]),
});
log("liveness", {
  sockFileExists: fs.existsSync(sock),
  socket: sockLive().split("\n").slice(-3),
  tmux:
    strategy === "tmux"
      ? run("tmux", ["-L", `kbs-${id}`, "has-session", "-t", "rt"]) || "has-session ok"
      : undefined,
  launchd:
    strategy === "launchd"
      ? run("launchctl", ["print", `gui/${uid}/com.k-bench.spike-rt-${id}`])
          .split("\n")
          .filter((l) => /state|pid =|last exit/.test(l))
          .map((l) => l.trim())
      : undefined,
});
// reconnect with a fresh client and wait for the result
const c2 =
  restart === "killrt"
    ? { stdout: "(skipped: runtime killed)", status: -1 }
    : spawnSync("node", [`${SPIKE}/client.mjs`, sock, "result"], {
        encoding: "utf8",
        timeout: 150000,
      });
const lines = c2.stdout.trim().split("\n");
log("client2", {
  tail: lines.slice(-8),
  replayed: lines.filter((l) => l.startsWith("R")).length,
  live: lines.filter((l) => l.startsWith("L")).length,
  status: c2.status,
});
const msgs = fs.existsSync(`${out}/messages.jsonl`)
  ? fs
      .readFileSync(`${out}/messages.jsonl`, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
  : [];
const result = msgs.find((m) => m.m?.type === "result");
log("turn", { gotResult: !!result, text: result?.m?.result, error: result?.m?.is_error });
log(
  "runtime-events",
  msgs
    .filter((m) => m.type === "runtime")
    .map((m) => ({ event: m.event, sig: m.sig, code: m.code, e: m.e })),
);
log("env", msgs.find((m) => m.event === "start")?.env);
// cleanup
run("launchctl", ["bootout", `gui/${uid}/${label}`]);
run("launchctl", ["bootout", `gui/${uid}/com.k-bench.spike-rt-${id}`]);
run("tmux", ["-L", `kbs-${id}`, "kill-server"]);
for (const p of ps()) {
  const pid = p.trim().split(" ")[0];
  if (+pid !== process.pid)
    try {
      process.kill(+pid, "SIGKILL");
    } catch {}
}
log("done", true);
