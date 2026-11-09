// Stand-in for the k-bench server: ensures the runtime exists using the chosen strategy, then idles.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const [id, strategy, outDir, sockPath, spikeDir] = process.argv.slice(2);
const log = (m) =>
  fs.appendFileSync(
    `${outDir}/parent.log`,
    `${new Date().toISOString()} pid=${process.pid} ${m}\n`,
  );
const node = process.execPath;
const runtime = [node, `${spikeDir}/runtime.mjs`, id, outDir, sockPath];
const shell = process.env.SHELL_FOR_SPIKE || "/bin/zsh";
const chain = (cmd) => [
  "/bin/zsh",
  "-f",
  "-c",
  'cd -- "$1"; shift; exec "$@"',
  "zsh",
  outDir,
  shell,
  "-l",
  "-i",
  "-c",
  'exec "$@"',
  "kb-login",
  ...cmd,
];
const uid = process.getuid();

function probe() {
  return new Promise((res) => {
    const c = net.connect(sockPath);
    const done = (v) => {
      c.destroy();
      res(v);
    };
    c.on("connect", () => done(true));
    c.on("error", () => done(false));
    setTimeout(() => done(false), 1500);
  });
}
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    return `ERR ${e.message}`;
  }
};

log(`parent start strategy=${strategy} cwd=${process.cwd()}`);
if (await probe()) {
  log("runtime already alive (socket answers); adopting");
} else {
  log("no runtime; launching");
  const argv = chain(runtime);
  if (strategy === "tmux") {
    const t = ["-L", `kbs-${id}`];
    log(sh("tmux", [...t, "new-session", "-d", "-s", "rt", "-c", outDir, ...argv]));
  } else if (strategy === "detached") {
    const out = fs.openSync(`${outDir}/detached.out`, "a");
    const c = spawn(argv[0], argv.slice(1), {
      detached: true,
      stdio: ["ignore", out, out],
    });
    c.unref();
    log(`spawned detached pid=${c.pid}`);
  } else if (strategy === "plain") {
    const out = fs.openSync(`${outDir}/plain.out`, "a");
    const c = spawn(argv[0], argv.slice(1), { stdio: ["ignore", out, out] });
    log(`spawned plain child pid=${c.pid}`);
  } else if (strategy === "launchd") {
    const label = `com.k-bench.spike-rt-${id}`;
    const plist = `${outDir}/rt.plist`;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    fs.writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${argv.map((a) => `<string>${esc(a)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH}</string><key>HOME</key><string>${process.env.HOME}</string></dict>
<key>StandardOutPath</key><string>${outDir}/rt-launchd.out</string><key>StandardErrorPath</key><string>${outDir}/rt-launchd.out</string>
</dict></plist>`,
    );
    sh("launchctl", ["bootout", `gui/${uid}/${label}`]);
    log(sh("launchctl", ["bootstrap", `gui/${uid}`, plist]) || "bootstrapped");
  }
}
setInterval(() => {}, 1 << 30);
