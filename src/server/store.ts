import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Migrations run in order on startup; `PRAGMA user_version` records how many have run.
 * Append only. Per ADR-0002 nothing here records process IDs or running/Stopped status.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE workspaces (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    folder   TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    UNIQUE (workspace_id, name)
  );
  `,
];

export interface WorkspaceRow {
  id: string;
  name: string;
  folder: string;
  position: number;
}
export interface SessionRow {
  id: string;
  workspaceId: string;
  name: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "k-bench.db"));
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let version = row.user_version; version < MIGRATIONS.length; version++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[version] as string);
        this.db.exec(`PRAGMA user_version = ${version + 1}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.db
      .prepare("SELECT id, name, folder, position FROM workspaces ORDER BY position")
      .all() as unknown as WorkspaceRow[];
  }

  getWorkspace(id: string): WorkspaceRow | undefined {
    return this.db
      .prepare("SELECT id, name, folder, position FROM workspaces WHERE id = ?")
      .get(id) as unknown as WorkspaceRow | undefined;
  }

  addWorkspace(input: { name: string; folder: string }): WorkspaceRow {
    const id = randomUUID();
    const next = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM workspaces")
      .get() as { position: number };
    this.db
      .prepare("INSERT INTO workspaces (id, name, folder, position) VALUES (?, ?, ?, ?)")
      .run(id, input.name, input.folder, next.position);
    return { id, name: input.name, folder: input.folder, position: next.position };
  }

  listSessions(workspaceId: string): SessionRow[] {
    return this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name FROM sessions
         WHERE workspace_id = ? ORDER BY created_at, rowid`,
      )
      .all(workspaceId) as unknown as SessionRow[];
  }

  getSession(id: string): (SessionRow & { folder: string }) | undefined {
    return this.db
      .prepare(
        `SELECT s.id, s.workspace_id AS workspaceId, s.name, w.folder
         FROM sessions s JOIN workspaces w ON w.id = s.workspace_id WHERE s.id = ?`,
      )
      .get(id) as unknown as (SessionRow & { folder: string }) | undefined;
  }

  renameSession(id: string, name: string): void {
    this.db.prepare("UPDATE sessions SET name = ? WHERE id = ?").run(name, id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  addSession(input: { id: string; workspaceId: string; name: string }): SessionRow {
    this.db
      .prepare(
        "INSERT INTO sessions (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(input.id, input.workspaceId, input.name, Date.now());
    return input;
  }
}
