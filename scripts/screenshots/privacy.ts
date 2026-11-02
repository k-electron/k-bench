// What must never show up in a screenshot or a recording. The real values are read from
// the machine the script runs on, so none of them is ever written down in the repo.
import { homedir, hostname, userInfo } from "node:os";

/** Strings that identify this machine or its owner. Short ones are skipped (too many false hits). */
export function machinePrivateStrings(): string[] {
  const host = hostname();
  const values = [
    homedir(),
    userInfo().username,
    host,
    host.split(".")[0] ?? "",
    process.env.USER ?? "",
    process.env.LOGNAME ?? "",
  ];
  return [...new Set(values.filter((value) => value.length >= 3))];
}

/** Shapes that are private whoever's machine this is. */
const PATTERNS: Array<{ what: string; pattern: RegExp }> = [
  {
    what: "an email address",
    pattern: /[\w.+-]+@(?!example\.(?:com|org)\b)[\w-]+(?:\.[\w-]+)+/g,
  },
  { what: "a personal path", pattern: /\/(?:Users|home)\/[\w.-]+/g },
  { what: "a tailnet name", pattern: /[\w-]+\.ts\.net/g },
  {
    what: "an account or plan",
    pattern: /\b(?:Claude (?:Max|Pro|Team|Enterprise)|[\w' -]+ Organization)\b/g,
  },
];

export interface Finding {
  what: string;
  match: string;
  context: string;
}

/**
 * Everything in `text` that looks private: this machine's own identifiers, the `extra`
 * strings the owner listed, and the generic shapes above. `allow` lists exact matches the
 * owner has looked at and accepted.
 */
export function findPrivate(
  text: string,
  options: { extra?: string[]; allow?: string[] } = {},
): Finding[] {
  const { extra = [], allow = [] } = options;
  const findings: Finding[] = [];
  const note = (what: string, match: string, index: number) => {
    if (allow.includes(match)) return;
    const context = text.slice(Math.max(0, index - 20), index + match.length + 20);
    findings.push({ what, match, context: context.replace(/\s+/g, " ") });
  };
  for (const value of [...machinePrivateStrings(), ...extra]) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) {
      note("this machine or a string you listed as private", value, at);
    }
  }
  for (const { what, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) note(what, match[0], match.index ?? 0);
  }
  return findings;
}

export function describeFindings(findings: Finding[]): string {
  return findings
    .map((f) => `  ${f.what}: "${f.match}" in ...${f.context}...`)
    .join("\n");
}
