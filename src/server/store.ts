import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type LaunchOptions, ROLE_LAUNCH_OPTIONS } from "../shared/launch-options.ts";
import type { SessionKind, SessionRole } from "../shared/state-protocol.ts";
import { availableName } from "./naming.ts";

/**
 * Migrations run in order on startup; `PRAGMA user_version` records how many have run.
 * Each is SQL, or a function for a change SQL can't make, and runs in its own transaction.
 * Append only. Per ADR-0002 nothing here records process IDs or running/Stopped status.
 */
const MIGRATIONS: Array<string | ((db: DatabaseSync) => void)> = [
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
  // A Session's role: 'prime' or 'worker' for a Workspace's two fixed Claude Sessions, null
  // for an Other Session. A Workspace has at most one of each.
  `
  ALTER TABLE sessions ADD COLUMN role TEXT;
  CREATE UNIQUE INDEX sessions_one_per_role ON sessions (workspace_id, role)
    WHERE role IS NOT NULL;
  `,
  // When each Workspace was created (milliseconds), so the folder picker can open next to the
  // newest. Workspaces from before this get their row order, which sorts them before any new one.
  `
  ALTER TABLE workspaces ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
  UPDATE workspaces SET created_at = rowid;
  `,
  // Every existing Workspace gets a Prime and a Worker, Stopped, each on a fresh conversation.
  addPrimeAndWorker,
];

/**
 * Records a Prime and a Worker for every Workspace. Existing Sessions stay as Other Sessions;
 * one already named "Prime" or "Worker" is renamed first, to "Prime (earlier)" for example,
 * so the names stay unique and the upgrade never fails.
 */
function addPrimeAndWorker(db: DatabaseSync): void {
  const roles = [
    { role: "prime", name: "Prime" },
    { role: "worker", name: "Worker" },
  ] as const;
  const workspaces = db.prepare("SELECT id FROM workspaces").all() as Array<{
    id: string;
  }>;
  const namesIn = db.prepare(
    "SELECT name, created_at AS createdAt FROM sessions WHERE workspace_id = ?",
  );
  const rename = db.prepare(
    "UPDATE sessions SET name = ? WHERE workspace_id = ? AND name = ?",
  );
  const insert = db.prepare(
    `INSERT INTO sessions
       (id, workspace_id, name, created_at, kind, role, conversation_id, launch_options)
     VALUES (?, ?, ?, ?, 'claude', ?, ?, ?)`,
  );
  for (const workspace of workspaces) {
    const rows = namesIn.all(workspace.id) as Array<{ name: string; createdAt: number }>;
    const taken = new Set(rows.map((row) => row.name));
    // Dated just before the Workspace's first Session, so they are listed first, as in a
    // new Workspace.
    const first = Math.min(Date.now(), ...rows.map((row) => row.createdAt));
    for (const { name } of roles) {
      if (!taken.has(name)) continue;
      const earlier = availableName(`${name} (earlier)`, taken);
      rename.run(earlier, workspace.id, name);
      taken.add(earlier);
    }
    for (const [index, { role, name }] of roles.entries()) {
      insert.run(
        randomUUID(),
        workspace.id,
        name,
        first - roles.length + index,
        role,
        randomUUID(),
        JSON.stringify(ROLE_LAUNCH_OPTIONS[role]),
      );
    }
  }
}

export interface WorkspaceRow {
  id: string;
  name: string;
  folder: string;
  position: number;
  /** Orders Workspaces by creation; larger is newer. */
  createdAt: number;
}
export interface SessionRow {
  id: string;
  workspaceId: string;
  name: string;
  kind: SessionKind;
  /** Whether it is the Workspace's Prime or Worker; null for an Other Session. */
  role: SessionRole | null;
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
        const migration = MIGRATIONS[version];
        if (typeof migration === "function") migration(this.db);
        else this.db.exec(migration as string);
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

  /** Runs `change` in one transaction: every write in it is kept, or none is. */
  transaction<T>(change: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = change();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.db
      .prepare(
        "SELECT id, name, folder, position, created_at AS createdAt FROM workspaces ORDER BY position",
      )
      .all() as unknown as WorkspaceRow[];
  }

  getWorkspace(id: string): WorkspaceRow | undefined {
    return this.db
      .prepare(
        "SELECT id, name, folder, position, created_at AS createdAt FROM workspaces WHERE id = ?",
      )
      .get(id) as unknown as WorkspaceRow | undefined;
  }

  addWorkspace(input: { name: string; folder: string }): WorkspaceRow {
    const id = randomUUID();
    const next = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM workspaces")
      .get() as { position: number };
    const createdAt = Date.now();
    this.db
      .prepare(
        "INSERT INTO workspaces (id, name, folder, position, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, input.name, input.folder, next.position, createdAt);
    return {
      id,
      name: input.name,
      folder: input.folder,
      position: next.position,
      createdAt,
    };
  }

  /** The most recently created Workspace, if there is one. */
  newestWorkspace(): WorkspaceRow | undefined {
    return this.db
      .prepare(
        "SELECT id, name, folder, position, created_at AS createdAt FROM workspaces ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get() as unknown as WorkspaceRow | undefined;
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
    this.transaction(() => {
      ids.forEach((id, index) => {
        update.run(index, id);
      });
    });
  }

  listSessions(workspaceId: string): SessionRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, kind, role,
                conversation_id AS conversationId, launch_options AS launchOptions
         FROM sessions WHERE workspace_id = ? ORDER BY created_at, rowid`,
      )
      .all(workspaceId) as unknown as RawSessionRow[];
    return rows.map(sessionRow);
  }

  getSession(id: string): (SessionRow & { folder: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT s.id, s.workspace_id AS workspaceId, s.name, s.kind, s.role,
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

  /**
   * Records the Claude conversation a Claude Session is now on, in place: no history is kept.
   * A shell Session, or one not stored yet, is left alone.
   */
  setConversationId(id: string, conversationId: string): void {
    this.db
      .prepare(
        `UPDATE sessions SET conversation_id = ?
         WHERE id = ? AND kind = 'claude' AND conversation_id IS NOT ?`,
      )
      .run(conversationId, id, conversationId);
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
    /** Makes it the Workspace's Prime or Worker. */
    role?: SessionRole;
  }): SessionRow {
    const conversationId = input.conversationId ?? null;
    const launchOptions = conversationId === null ? null : (input.launchOptions ?? null);
    const kind = conversationId === null ? "shell" : "claude";
    const role = input.role ?? null;
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, workspace_id, name, created_at, kind, role, conversation_id, launch_options)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.name,
        Date.now(),
        kind,
        role,
        conversationId,
        launchOptions && JSON.stringify(launchOptions),
      );
    return {
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      kind,
      role,
      conversationId,
      launchOptions,
    };
  }
}
