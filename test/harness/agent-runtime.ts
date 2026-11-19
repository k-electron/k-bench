// The Agent Runtime the tests start Claude Agents with: the real one, built from this
// checkout, with the real Agent SDK inside (docs/internals/test-seams.md).
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const FOLDER = join(REPO_ROOT, "node_modules/.cache/k-bench/agent-runtime");

/**
 * Where the harness's build of the runtime is. It is not `dist/runtime`, where `pnpm build`
 * (the packed-install test runs it) writes the shipped one: a build there would replace the
 * file under tests that are copying it. Every instance's server installs this file.
 */
export const HARNESS_RUNTIME_FILE = join(FOLDER, "agent-runtime.mjs");

/** The newest modification time under `paths`, files or folders. */
function newest(paths: string[]): number {
  let latest = 0;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    latest = Math.max(latest, stat.mtimeMs);
    if (stat.isDirectory()) {
      latest = Math.max(
        latest,
        newest(readdirSync(path).map((name) => join(path, name))),
      );
    }
  }
  return latest;
}

/**
 * Builds the runtime into `HARNESS_RUNTIME_FILE` unless it is already newer than everything it
 * is built from (its source, the shared protocol, the build config, the lockfile that pins the
 * SDK). Both global setups call it, Vitest's and Playwright's, because each starts servers
 * that start Agents. The file is built elsewhere and moved into place, so a second run
 * starting at the same time never reads half a file.
 */
export function buildAgentRuntime(): void {
  const inputs = [
    "src/agent-runtime",
    "src/agent",
    "src/shared",
    "vite.runtime.config.ts",
    "package.json",
    "pnpm-lock.yaml",
  ].map((path) => join(REPO_ROOT, path));
  if (existsSync(HARNESS_RUNTIME_FILE)) {
    if (statSync(HARNESS_RUNTIME_FILE).mtimeMs > newest(inputs)) return;
  }
  const staging = `${FOLDER}.building-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "vite",
        "build",
        "--config",
        "vite.runtime.config.ts",
        "--outDir",
        staging,
        "--logLevel",
        "warn",
      ],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    mkdirSync(FOLDER, { recursive: true });
    renameSync(join(staging, "agent-runtime.mjs"), HARNESS_RUNTIME_FILE);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Writes another build of the runtime to `<folder>/<label>/agent-runtime.mjs` and returns its
 * path: the harness build with a comment appended, so it is the same code under another build
 * ID (an update that changed the runtime), or, with `protocol`, one whose hello names a
 * protocol number other than the one this k-bench speaks. For a test of an update under a
 * running Agent: pass the path as `instance.start({ agentRuntimeFile })`.
 */
export function writeRuntimeVariant(
  folder: string,
  label: string,
  options: { protocol?: number } = {},
): string {
  let code = readFileSync(HARNESS_RUNTIME_FILE, "utf8");
  if (options.protocol !== undefined) {
    const hello = /(type: "hello",\s*protocol: )\d+,/;
    if (!hello.test(code)) throw new Error("The built runtime's hello has changed shape");
    code = code.replace(hello, `$1${options.protocol},`);
  }
  const file = join(folder, label, "agent-runtime.mjs");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${code}\n// variant: ${label}\n`);
  return file;
}
