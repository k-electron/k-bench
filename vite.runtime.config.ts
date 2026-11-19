import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Builds the Agent Runtime (src/agent-runtime) into ONE self-contained file with the Agent
 * SDK inside, `dist/runtime/agent-runtime.mjs`: `pnpm build:runtime`. It runs under plain
 * `node`, so k-bench's published package needs no copy of the SDK, and installing k-bench
 * never fetches the SDK's platform package with its bundled Claude Code (about 338 MB). The
 * SDK is a development dependency only. The file's SHA-256 is the runtime build ID.
 *
 * `--outDir` builds elsewhere (the test harness does, so a `pnpm build` running beside it
 * cannot replace the file under it).
 */
const sdk = JSON.parse(
  readFileSync(
    resolve("node_modules/@anthropic-ai/claude-agent-sdk/package.json"),
    "utf8",
  ),
) as { version: string; claudeCodeVersion: string };

export default defineConfig({
  // The version the SDK was released with, and the Claude Code it was made for, baked in:
  // the SDK is not installed where the runtime runs.
  define: {
    __SDK_VERSION__: JSON.stringify(sdk.version),
    __SDK_CLAUDE_CODE_VERSION__: JSON.stringify(sdk.claudeCodeVersion),
  },
  // Everything in, node's own modules excepted.
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: resolve("src/agent-runtime/main.ts"),
    outDir: "dist/runtime",
    emptyOutDir: false,
    // Unminified: a reason in a stack trace should be readable.
    minify: false,
    rollupOptions: {
      output: { format: "es", entryFileNames: "agent-runtime.mjs", codeSplitting: false },
    },
  },
});
