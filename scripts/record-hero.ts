// `pnpm screenshots:record`: records a program's terminal output, with timing, into a
// recording file that `pnpm screenshots` can play back. It is how the hero image's Claude
// Code recording is made (steps in scripts/screenshots/hero.shots.ts).
//
//   pnpm screenshots:record                    record `claude` in the current folder
//   pnpm screenshots:record -- sh -c 'ls'      record another command instead (after --)
//   options: --cols 110 --rows 32 --out .scratch/claude-hero.raw.json
//
// The program runs in a terminal of exactly --cols x --rows, whatever size yours is, so
// make your terminal window at least that big while you record. You type to it as usual;
// the recording ends when the program exits.
//
// The raw recording is NOT safe to publish: Claude Code's banner shows your account, plan,
// email, organisation and the folder's path. It is written under .scratch/, which git
// ignores. Run `pnpm screenshots:scrub` on it next.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as pty from "node-pty";
import { RecordingBuilder, writeRecording } from "./screenshots/recording.ts";

const separator = process.argv.indexOf("--");
const optionArgs = process.argv.slice(2, separator === -1 ? undefined : separator);
const command = separator === -1 ? ["claude"] : process.argv.slice(separator + 1);
const { values } = parseArgs({
  args: optionArgs,
  options: {
    cols: { type: "string", default: "110" },
    rows: { type: "string", default: "32" },
    out: { type: "string", default: ".scratch/claude-hero.raw.json" },
  },
});
const cols = Number(values.cols);
const rows = Number(values.rows);
const out = resolve(values.out);

const [program, ...args] = command;
if (!program) {
  console.error("No command to record");
  process.exit(2);
}
if ((process.stdout.columns ?? cols) < cols || (process.stdout.rows ?? rows) < rows) {
  console.error(
    `Your terminal is ${process.stdout.columns}x${process.stdout.rows}; make it at least ` +
      `${cols}x${rows} so what you see is what is recorded.`,
  );
  process.exit(2);
}

const recording = new RecordingBuilder({
  note: `Output of: ${command.join(" ")}`,
  cols,
  rows,
});
const child = pty.spawn(program, args, {
  name: "xterm-256color",
  cols,
  rows,
  cwd: process.cwd(),
  env: { ...process.env, COLORTERM: "truecolor" } as Record<string, string>,
  encoding: null,
});
child.onData((data) => {
  const chunk = Buffer.from(data as unknown as Uint8Array);
  recording.add(chunk);
  process.stdout.write(chunk);
});
process.stdin.setRawMode?.(true);
process.stdin.on("data", (data) => child.write(data.toString()));
process.stdin.resume();

child.onExit(({ exitCode }) => {
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  mkdirSync(dirname(out), { recursive: true });
  writeRecording(out, recording.build());
  console.log(
    `\nRecorded to ${out}\nIt may show private details: run \`pnpm screenshots:scrub\` before using it.`,
  );
  process.exit(exitCode);
});
