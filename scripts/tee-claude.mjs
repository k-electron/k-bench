#!/usr/bin/env node
// Stands between the Agent SDK and the real `claude` while recording the fake Claude's
// fixtures (scripts/record-fake-claude.ts). It runs `claude` with the arguments it was given
// and copies every line each way into the file named by K_BENCH_RECORD_FILE, as one JSON
// object per line: {"dir":"argv"|"in"|"out","line":...}. Only the recording script uses it.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const file = process.env.K_BENCH_RECORD_FILE;
const real = process.env.K_BENCH_REAL_CLAUDE;
if (!file || !real) {
  console.error("tee-claude: K_BENCH_RECORD_FILE and K_BENCH_REAL_CLAUDE are required");
  process.exit(2);
}
const record = (dir, line) => appendFileSync(file, `${JSON.stringify({ dir, line })}\n`);

record("argv", process.argv.slice(2));
const child = spawn(real, process.argv.slice(2), {
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});
createInterface({ input: process.stdin }).on("line", (line) => {
  record("in", line);
  child.stdin.write(`${line}\n`);
});
process.stdin.on("end", () => child.stdin.end());
createInterface({ input: child.stdout }).on("line", (line) => {
  record("out", line);
  process.stdout.write(`${line}\n`);
});
child.on("exit", (code, signal) => {
  record("exit", { code, signal });
  process.exit(code ?? 1);
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
