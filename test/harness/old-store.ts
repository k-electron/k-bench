import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TestInstance } from "./instance.ts";

/** The tables as the first version of k-bench (schema version 1) made them. */
const FIRST_TABLES = `
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (workspace_id, name));
`;

/**
 * Writes the store as an older k-bench left it into the instance's data folder, before the
 * instance first starts, so the test sees it upgraded: the first version's tables, then
 * `sql` (any later version's changes, and the rows), marked as schema `version`.
 */
export function writeOldStore(
  instance: TestInstance,
  version: number,
  sql: string,
): void {
  mkdirSync(instance.config.dataDir, { recursive: true });
  const old = new DatabaseSync(join(instance.config.dataDir, "k-bench.db"));
  try {
    old.exec(`${FIRST_TABLES}\n${sql}\nPRAGMA user_version = ${version};`);
  } finally {
    old.close();
  }
}
