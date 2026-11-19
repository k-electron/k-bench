/**
 * Where a Claude Agent's files are. Plain path arithmetic, shared by the server and the
 * Agent Runtime, which must agree on every one of these (docs/internals/agent.md).
 */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** The folder holding every Agent's folder: `<dataDir>/agents`. Owner-only. */
export function agentsRoot(dataDir: string): string {
  return join(dataDir, "agents");
}

/**
 * One Agent's folder, named by its Session's ID: its log, socket (`agent.sock`, reached by
 * a short link: src/server/agent-socket-path.ts) and exit record.
 */
export function agentFolder(dataDir: string, sessionId: string): string {
  return join(agentsRoot(dataDir), sessionId);
}

/** The append-only log inside an Agent's folder (`AgentLog`). */
export function agentLogFile(folder: string): string {
  return join(folder, "log.jsonl");
}

/** The images uploaded for the Agent's prompts: `<agent folder>/images/`. Created by the server. */
export function agentImagesFolder(folder: string): string {
  return join(folder, "images");
}

/** Why the runtime ended, written on its way out (`writeExitRecord`). */
export function agentExitFile(folder: string): string {
  return join(folder, "exit.json");
}

/** The folder under the data directory that holds every installed runtime build. */
export function runtimesRoot(dataDir: string): string {
  return join(dataDir, "runtimes");
}

/** Where a runtime build is installed: `<dataDir>/runtimes/<build id>/agent-runtime.mjs`. */
export function runtimeFile(dataDir: string, buildId: string): string {
  return join(runtimesRoot(dataDir), buildId, "agent-runtime.mjs");
}

/** The runtime build ID of a runtime file's bytes: their SHA-256, in hex. */
export function runtimeBuildId(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Creates `folder` (its parent must exist) readable by the owner's Mac user only. The mode
 * is set after creating it, because `mkdir`'s own is cut down by the umask. Only the server
 * creates these folders: the runtime and the launcher never do, so a runtime that is still
 * exiting cannot bring back a folder the server just deleted.
 */
export function makeOwnerOnlyFolder(folder: string): void {
  mkdirSync(folder, { mode: 0o700 });
  chmodSync(folder, 0o700);
}

/** Like `makeOwnerOnlyFolder`, but fine when the folder is already there. */
export function ensureOwnerOnlyFolder(folder: string): void {
  try {
    makeOwnerOnlyFolder(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    chmodSync(folder, 0o700);
  }
}
