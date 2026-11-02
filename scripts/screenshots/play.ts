// Plays a recording back into the terminal it runs in, with its original timing (long
// pauses shortened). The screenshots script runs it inside a Session, so the Session shows
// what was recorded, drawn by the real terminal and tmux.
//
//   node play.ts <recording.json>
//
// K_BENCH_PLAY_DONE, when set, names a file created once the last event has been played.
// The player then stays put, so the shell prompt does not draw over the picture.
import { writeFileSync } from "node:fs";
import { readRecording } from "./recording.ts";

const MAX_GAP_MS = 400;

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: play.ts <recording.json>");
  process.exit(2);
}
const recording = readRecording(path);
const cols = process.stdout.columns;
const rows = process.stdout.rows;
if (cols !== recording.cols || rows !== recording.rows) {
  console.error(
    `The recording is ${recording.cols}x${recording.rows} but this terminal is ${cols}x${rows}`,
  );
  process.exit(3);
}

const write = (text: string) =>
  new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));

// A recorded program may ask the terminal about itself; the terminal's answers arrive on
// stdin and must not be echoed onto the screen. Raw mode turns echo off; the answers are dropped.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", () => undefined);

// Clear the screen and the line that started this player, then draw from the top.
await write("\x1b[H\x1b[2J\x1b[3J");
let previous = 0;
for (const [at, text] of recording.events) {
  const gap = Math.min(at - previous, MAX_GAP_MS);
  previous = at;
  if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
  await write(text);
}
if (process.env.K_BENCH_PLAY_DONE) writeFileSync(process.env.K_BENCH_PLAY_DONE, "done");
// Stay alive until the Session is closed.
setInterval(() => undefined, 1 << 30);
