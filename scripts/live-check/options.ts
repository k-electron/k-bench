import { parseArgs } from "node:util";

export const FAKE_BREAKS = ["model", "settings", "risky-settings", "leftover"] as const;

export interface Options {
  confirm: boolean;
  fake: boolean;
  only: string[];
  out?: string;
  budget: number;
  claude?: string;
  fakeBreak?: string;
  help: boolean;
}

export const HELP = `pnpm live-check: runs the real \`claude\` (its Agent SDK use) against what k-bench's Claude Agent assumes, and says which assumptions held. Issue #161, part A. Run by hand; never by pnpm check, pnpm test, pnpm test:e2e or CI.

  node scripts/live-check.ts [--confirm] [--only <check>[,<check>]] [--fake] [--out <dir>] [--budget <turns>]

  --confirm        required to run against the real \`claude\`: it spends the owner's subscription turns (Haiku, low effort). Without it the script only prints what it would do and exits 0, having spent nothing.
  --fake           run the same script against the fake Claude of the test harness, in a temp folder and a temp Claude Code folder: no login, no turns. Exercises the rails, recording, redaction, cleanup and the checks; its verdicts say PASS (fake) and prove nothing about \`claude\`. Needs no --confirm.
  --only a,b       run only these checks (and the scenarios they need). Names: see the table the script prints without --confirm.
  --out <dir>      where results.md and the redacted recordings go (default: a new folder in the system temp folder, outside the repository).
  --budget <n>     the most model turns the run may spend (default 25). The run stops the moment it is spent; checks that did not fit say NOT RUN (budget).
  --claude <path>  the \`claude\` to run (default: the first on PATH).
  --fake-break <fault>
                   with --fake: make the fake misbehave, to show a rail catches it: ${FAKE_BREAKS.join(", ")}.
  --help           this text.

Read docs/internals/live-check.md first.`;

export function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      confirm: { type: "boolean", default: false },
      fake: { type: "boolean", default: false },
      only: { type: "string" },
      out: { type: "string" },
      budget: { type: "string", default: "25" },
      claude: { type: "string" },
      "fake-break": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const budget = Number(values.budget);
  if (!Number.isInteger(budget) || budget < 1 || budget > 200) {
    throw new Error("--budget must be a whole number of turns from 1 to 200");
  }
  const fakeBreak = values["fake-break"];
  if (fakeBreak !== undefined) {
    if (!values.fake) throw new Error("--fake-break needs --fake");
    if (!(FAKE_BREAKS as readonly string[]).includes(fakeBreak)) {
      throw new Error(`--fake-break is one of: ${FAKE_BREAKS.join(", ")}`);
    }
  }
  return {
    confirm: values.confirm ?? false,
    fake: values.fake ?? false,
    only: (values.only ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    ...(values.out ? { out: values.out } : {}),
    budget,
    ...(values.claude ? { claude: values.claude } : {}),
    ...(fakeBreak ? { fakeBreak } : {}),
    help: values.help ?? false,
  };
}
