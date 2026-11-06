import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LaunchOptions } from "../shared/launch-options.ts";
import type { SessionKind } from "../shared/state-protocol.ts";

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
  // A Session's kind (every row so far is a shell Session) and, for a Claude Session, the
  // conversation ID k-bench generated for it.
  `
  ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'shell';
  ALTER TABLE sessions ADD COLUMN conversation_id TEXT;
  `,
  // A Claude Session's Launch options, as JSON, so a restart can pass them again.
  `
  ALTER TABLE sessions ADD COLUMN launch_options TEXT;
  `,
  // The Host's one record of the Launch options last used to create a Claude Session; the id
  // check keeps it to one row.
  `
  CREATE TABLE claude_last_launch_options (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    options TEXT NOT NULL
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
  kind: SessionKind;
  /** The Claude conversation a Claude Session runs; null for a shell Session. */
  conversationId: string | null;
  /** The Launch options a Claude Session was created with; null for a shell Session. */
  launchOptions: LaunchOptions | null;
}

/** A session row as SQLite returns it: the Launch options are still JSON text. */
type RawSessionRow = Omit<SessionRow, "launchOptions"> & { launchOptions: string | null };

function sessionRow<T extends RawSessionRow>(
  raw: T,
): Omit<T, "launchOptions"> & { launchOptions: LaunchOptions | null } {
  return {
    ...raw,
    launchOptions: raw.launchOptions === null ? null : JSON.parse(raw.launchOptions),
  };
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

  updateWorkspace(id: string, changes: { name?: string; folder?: string }): void {
    if (changes.name !== undefined) {
      this.db
        .prepare("UPDATE workspaces SET name = ? WHERE id = ?")
        .run(changes.name, id);
    }
    if (changes.folder !== undefined) {
      this.db
        .prepare("UPDATE workspaces SET folder = ? WHERE id = ?")
        .run(changes.folder, id);
    }
  }

  /** Sessions go with it (ON DELETE CASCADE). */
  deleteWorkspace(id: string): void {
    this.db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  }

  /** Gives each Workspace the position of its index in `ids`, in one transaction. */
  setWorkspaceOrder(ids: string[]): void {
    const update = this.db.prepare("UPDATE workspaces SET position = ? WHERE id = ?");
    this.db.exec("BEGIN");
    try {
      ids.forEach((id, index) => {
        update.run(index, id);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listSessions(workspaceId: string): SessionRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, kind,
                conversation_id AS conversationId, launch_options AS launchOptions
         FROM sessions WHERE workspace_id = ? ORDER BY created_at, rowid`,
      )
      .all(workspaceId) as unknown as RawSessionRow[];
    return rows.map(sessionRow);
  }

  getSession(id: string): (SessionRow & { folder: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT s.id, s.workspace_id AS workspaceId, s.name, s.kind,
                s.conversation_id AS conversationId,
                s.launch_options AS launchOptions, w.folder
         FROM sessions s JOIN workspaces w ON w.id = s.workspace_id WHERE s.id = ?`,
      )
      .get(id) as unknown as (RawSessionRow & { folder: string }) | undefined;
    return row && sessionRow(row);
  }

  /** The Launch options last used to create a Claude Session, if any has been created. */
  getLastLaunchOptions(): LaunchOptions | undefined {
    const row = this.db
      .prepare("SELECT options FROM claude_last_launch_options WHERE id = 1")
      .get() as { options: string } | undefined;
    return row && JSON.parse(row.options);
  }

  setLastLaunchOptions(options: LaunchOptions): void {
    this.db
      .prepare(
        `INSERT INTO claude_last_launch_options (id, options) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET options = excluded.options`,
      )
      .run(JSON.stringify(options));
  }

  renameSession(id: string, name: string): void {
    this.db.prepare("UPDATE sessions SET name = ? WHERE id = ?").run(name, id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  addSession(input: {
    id: string;
    workspaceId: string;
    name: string;
    /** Makes it a Claude Session running this conversation. */
    conversationId?: string;
    /** The Launch options of a Claude Session. */
    launchOptions?: LaunchOptions;
  }): SessionRow {
    const conversationId = input.conversationId ?? null;
    const launchOptions = conversationId === null ? null : (input.launchOptions ?? null);
    const kind = conversationId === null ? "shell" : "claude";
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, workspace_id, name, created_at, kind, conversation_id, launch_options)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.name,
        Date.now(),
        kind,
        conversationId,
        launchOptions && JSON.stringify(launchOptions),
      );
    return {
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      kind,
      conversationId,
      launchOptions,
    };
  }
}
