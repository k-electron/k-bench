// Watching the owner's Claude Code settings files for a change, and saying which scenario it
// happened in and which keys changed. Only the key paths are ever reported, never a value
// (settings hold paths and secrets), and the files' texts are kept in memory alone, never
// written anywhere. Another Claude Code running on the machine may rewrite a settings file
// by itself (to save a default, say), so a change is attributed to the scenario that was
// running, not blamed on the script.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SettingsChange {
  /** The scenario that was running (or `after the last scenario`). */
  scenario: string;
  file: string;
  /** Key paths such as `permissions.allow` or `modelSettings.some-model`; never values. */
  paths: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The paths of the keys that differ between two parsed JSON values. Arrays and scalars are compared whole. */
export function changedKeyPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (isObject(before) && isObject(after)) {
    const paths: string[] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (!(key in before) || !(key in after)) paths.push(path);
      else paths.push(...changedKeyPaths(before[key], after[key], path));
    }
    return paths;
  }
  return JSON.stringify(before) === JSON.stringify(after)
    ? []
    : [prefix || "(whole file)"];
}

export class SettingsWatch {
  private readonly dir: string;
  private readonly files: readonly string[];
  /** What each file held at the last look (in memory only). */
  private texts = new Map<string, string | undefined>();

  constructor(dir: string, files: readonly string[]) {
    this.dir = dir;
    this.files = files;
    for (const file of files) this.texts.set(file, this.read(file));
  }

  private read(file: string): string | undefined {
    const path = join(this.dir, file);
    try {
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    } catch {
      return undefined;
    }
  }

  /** What changed since the last look, attributed to `scenario`; the look is the new baseline. */
  check(scenario: string): SettingsChange[] {
    const changes: SettingsChange[] = [];
    for (const file of this.files) {
      const before = this.texts.get(file);
      const after = this.read(file);
      if (before === after) continue;
      this.texts.set(file, after);
      let paths: string[];
      if (before === undefined) paths = ["(file created)"];
      else if (after === undefined) paths = ["(file removed)"];
      else {
        try {
          paths = changedKeyPaths(JSON.parse(before), JSON.parse(after));
        } catch {
          paths = ["(not valid JSON)"];
        }
        if (paths.length === 0) paths = ["(formatting only)"];
      }
      changes.push({ scenario, file, paths });
    }
    return changes;
  }
}
