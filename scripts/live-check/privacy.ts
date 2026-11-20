// Nothing personal reaches what the live check writes (the redacted recordings and results.md),
// which the owner may post to an issue. The same replacements as the fixture recorder
// (scripts/redaction.ts), then the same net as the screenshot scrubber (it looks for this
// machine's user name, home folder and host name, email addresses, tailnet names and Claude
// plan names), and a file that still looks private is not written.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { type Json, redact, scrub } from "../redaction.ts";
import { findPrivate, machinePrivateStrings } from "../screenshots/privacy.ts";

/** Where the run's private paths are, so that they can be replaced. */
export interface Places {
  /** The run's temp folder (holds the throwaway folder and the raw material). */
  tmp: string;
  /** The throwaway folder. */
  folder: string;
  /** Claude Code's folder. */
  configDir: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text with the run's paths, the person and the machine taken out. Safe to apply to JSON text. */
export function redactText(text: string, places: Places): string {
  let out = text;
  const folders: Array<[string, string]> = [
    [places.folder, "/home/you/project"],
    [places.tmp, "/tmp/live-check"],
    [places.configDir, "/home/you/.claude"],
  ];
  for (const [secret, replacement] of folders.sort((a, b) => b[0].length - a[0].length)) {
    if (secret.length > 2) out = out.split(secret).join(replacement);
  }
  out = out
    .split(homedir())
    .join("/home/you")
    .replace(/\/Users\/[^/\s"\\]+/g, "/home/you")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "you@example.com")
    .replace(/Claude (Max|Pro|Team|Enterprise)/g, "a subscription")
    .replace(/[\w' -]+ Organization/g, "<org>")
    .replace(/[\w-]+\.ts\.net/g, "<tailnet>")
    .replace(/\bsk-ant-[\w-]+/g, "sk-ant-REDACTED");
  for (const secret of machinePrivateStrings()) {
    out = out.replace(new RegExp(escapeRegExp(secret), "gi"), "<private>");
  }
  return out;
}

/** What the check's own hooks print (issue #177): output carrying it is the check's, not the owner's. */
export const HOOK_MARK = "KBLC";

const lengthLabel = (value: unknown) =>
  typeof value === "string" && value !== ""
    ? `<owner's text, ${value.length} chars>`
    : value;

/** What a recording keeps of a message: the shared scrub, then what only a live run holds (hook output). */
function scrubLive(message: Json): Json {
  const copy = scrub(message);
  const ours = JSON.stringify(copy).includes(HOOK_MARK);
  if (copy.type === "system" && typeof copy.subtype === "string") {
    // A hook's lifecycle message keeps its shape; its output only when the check's own hook printed it.
    if (/^hook_/.test(copy.subtype)) {
      if (ours) return copy;
      const shape: Json = {};
      for (const [key, value] of Object.entries(copy)) {
        shape[key] = ["stdout", "stderr", "output"].includes(key)
          ? lengthLabel(value)
          : value;
      }
      return shape;
    }
    if (copy.subtype === "informational" && !ours) {
      return { ...copy, content: lengthLabel(copy.content) };
    }
    if (/^(memory_recall|plugin_install)/.test(copy.subtype)) {
      return {
        type: copy.type,
        subtype: copy.subtype,
        session_id: copy.session_id,
        uuid: copy.uuid,
      };
    }
  }
  // Claude Code's own note in an assistant message (a hook's `systemMessage`, say): the
  // owner's hooks' text is not kept.
  if (copy.type === "assistant" && copy.is_meta === true && !ours) {
    const inner = copy.message as Json | undefined;
    if (inner && Array.isArray(inner.content)) {
      inner.content = (inner.content as Json[]).map((block) =>
        block.type === "text" ? { ...block, text: lengthLabel(block.text) } : block,
      );
    }
  }
  return copy;
}

/** One message of a real run as a line a recording may hold. */
export function recordableLine(message: Json, places: Places): string {
  const redacted = redact(scrubLive(message), places.tmp, [
    [places.folder, "/home/you/project"],
    [places.configDir, "/home/you/.claude"],
  ]);
  return redactText(JSON.stringify(redacted), places);
}

export class PrivacyError extends Error {}

/** Throws, with the kinds of what was found and never the text, if `text` still looks private. */
export function assertNothingPrivate(text: string, what: string): void {
  const findings = findPrivate(text, { allow: ["/home/you"] });
  if (findings.length === 0) return;
  const kinds = [...new Set(findings.map((finding) => finding.what))].join("; ");
  throw new PrivacyError(
    `${what} was not written: it still looks private (${kinds}). ${describeCount(findings.length)}`,
  );
}

const describeCount = (count: number) => `${count} match${count === 1 ? "" : "es"}.`;

/** Writes `text` where `path` says, after the guard. Returns whether it was written. */
export function writeChecked(path: string, text: string, what: string): boolean {
  assertNothingPrivate(text, what);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}
