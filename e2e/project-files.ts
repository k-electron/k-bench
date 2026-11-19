import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Fills a test instance's folder with empty files, adds `src/app.log`, which a `.gitignore`
 * makes git ignore, and makes it a git repository, for the `@` picker. Git runs on that
 * folder alone.
 */
export function makeRepository(folder: string, files: string[]): void {
  for (const path of [".gitignore", "src/app.log", ...files]) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), path === ".gitignore" ? "*.log\n" : "");
  }
  execFileSync("git", ["init", "--quiet"], { cwd: folder });
}
