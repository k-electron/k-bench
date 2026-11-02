// `pnpm screenshots:scrub`: turns a raw recording into one safe to commit, by rewriting the
// private strings you name, then refusing to write it while anything private is left.
//
//   pnpm screenshots:scrub --replace "private=>public" [--replace ...] [--print]
//
//   --replace   what to rewrite, as private=>public. The public text is padded with spaces
//               to the private text's width and may not be longer, so text laid out in
//               columns keeps its shape. Repeat it for each string. The private strings
//               are given here (or in K_BENCH_SCRUB, one pair per line), never in the repo.
//   --allow     a match the check below flagged that you have looked at and accept
//   --in/--out  default .scratch/claude-hero.raw.json -> docs/recordings/claude-hero.json
//   --print     show the scrubbed recording as plain text, to read all of it
//
// The check looks for what you named (still there after the rewrite, say because the
// terminal drew it a character at a time), this machine's username, host name and home
// folder, email addresses other than @example.com, /Users and /home paths, tailnet names
// (.ts.net) and Claude plan or organisation names. Exit code 1 and nothing written if any
// are found. It is a net, not a proof: also read the output of --print, and later the image.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { describeFindings, findPrivate } from "./screenshots/privacy.ts";
import {
  parseReplacement,
  plainText,
  readRecording,
  scrub,
  writeRecording,
} from "./screenshots/recording.ts";

const { values } = parseArgs({
  options: {
    in: { type: "string", default: ".scratch/claude-hero.raw.json" },
    out: { type: "string", default: "docs/recordings/claude-hero.json" },
    replace: { type: "string", multiple: true, default: [] },
    allow: { type: "string", multiple: true, default: [] },
    print: { type: "boolean", default: false },
  },
});

const pairs = [
  ...values.replace,
  ...(process.env.K_BENCH_SCRUB ?? "").split("\n").filter((line) => line.trim() !== ""),
];
const replacements = pairs.map(parseReplacement);

const scrubbed = scrub(readRecording(resolve(values.in)), replacements);
const text = plainText(scrubbed);
if (values.print) console.log(text);

const findings = findPrivate(text, {
  extra: replacements.map((r) => r.from),
  allow: values.allow,
});
if (findings.length > 0) {
  console.error(
    `\nNot written: this still looks private.\n${describeFindings(findings)}`,
  );
  process.exit(1);
}

const out = resolve(values.out);
mkdirSync(dirname(out), { recursive: true });
writeRecording(out, scrubbed);
console.log(
  `Wrote ${out} (${replacements.length} replacements). Now read it (--print) and the image.`,
);
