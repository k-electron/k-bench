import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  DEFAULT_LAUNCH_OPTIONS,
  type LaunchOptions,
  ROLE_LAUNCH_OPTIONS,
} from "../shared/launch-options.ts";
import { sessionsByRole } from "../shared/session-roles.ts";
import type {
  RightPaneState,
  SessionActivity,
  SessionKind,
  SessionRole,
  State,
} from "../shared/state-protocol.ts";
import type { ClaudeLaunch } from "./claude.ts";
import { availableName } from "./naming.ts";
import { Reconciler } from "./reconciler.ts";
import type { Store } from "./store.ts";
import type { LiveSession, TmuxDriver } from "./tmux.ts";

/**
 * A failure the HTTP layer maps to a status code. `details` go into the response body
 * next to the message, for a client that acts on the refusal.
 */
export class ServiceError extends Error {
  readonly kind: "not_found" | "conflict" | "invalid";
  readonly details: Record<string, unknown>;

  constructor(
    kind: "not_found" | "conflict" | "invalid",
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.kind = kind;
    this.details = details;
  }
}

/** A Workspace's Prime and Worker, in the order they are listed. */
const ROLES: readonly SessionRole[] = ["prime", "worker"];

/** The fixed names of the Prime and Worker, which no Other Session may take. */
const ROLE_NAMES: Record<SessionRole, string> = { prime: "Prime", worker: "Worker" };

function isRoleName(name: string): boolean {
  return ROLES.some((role) => ROLE_NAMES[role] === name);
}

/** The Prime and Worker last as long as their Workspace, under their fixed names. */
function assertNoRole(session: { role: SessionRole | null }, change: string): void {
  if (session.role) {
    throw new ServiceError(
      "conflict",
      `The ${ROLE_NAMES[session.role]} can't be ${change}`,
    );
  }
}

const ACTIVITIES: readonly SessionActivity[] = ["working", "waiting", "idle"];

/**
 * A Session's state: none for a shell or a Stopped Session. A running Claude Session is in the
 * state its hooks last wrote, and Idle until one has run (or when what they wrote isn't one).
 */
function activityOf(
  session: { kind: SessionKind },
  live: LiveSession | undefined,
): SessionActivity | null {
  if (session.kind !== "claude" || !live) return null;
  return ACTIVITIES.find((activity) => activity === live.activity) ?? "idle";
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function assertDirectory(folder: string): void {
  if (!isDirectory(folder)) {
    throw new ServiceError("invalid", `Folder does not exist: ${folder}`);
  }
}

/** Why a folder couldn't be made, in the owner's words. */
function mkdirFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EEXIST" || code === "ENOTDIR") return "a file is in the way";
  if (code === "EACCES" || code === "EPERM") return "permission denied";
  if (code === "ENAMETOOLONG") return "the name is too long";
  return code ?? String(error);
}

/**
 * Makes `folder` and any missing folders above it, from the top down. A failure names the
 * folder that couldn't be made; the folders made before it stay.
 */
function makeFolders(folder: string): void {
  const missing: string[] = [];
  for (
    let path = folder;
    !isDirectory(path) && path !== dirname(path);
    path = dirname(path)
  ) {
    missing.unshift(path);
  }
  for (const path of missing) {
    try {
      mkdirSync(path);
    } catch (error) {
      throw new ServiceError(
        "invalid",
        `Couldn't make the folder ${path}: ${mkdirFailure(error)}`,
      );
    }
  }
}

/** The domain operations. The store holds what the owner chose; tmux says what is alive. */
export class Service {
  private readonly store: Store;
  private readonly tmux: TmuxDriver;
  private sessionCreations: Promise<unknown> = Promise.resolve();
  private readonly reconciler: Reconciler;
  private readonly restarts = new Map<string, Promise<void>>();
  /** How long a Working Session prints nothing before it decays to Idle. */
  private readonly workingQuietMs: number;

  constructor(store: Store, tmux: TmuxDriver, options: { workingQuietMs: number }) {
    this.store = store;
    this.tmux = tmux;
    this.reconciler = new Reconciler(store, tmux);
    this.workingQuietMs = options.workingQuietMs;
  }

  /**
   * Kills tmux sessions that have no store record and stores the conversation each Claude
   * Session is on. Runs at startup, on every state read and whenever Claude Code reports a
   * conversation.
   */
  async reconcile(): Promise<void> {
    await this.reconciler.reconcile();
  }

  /**
   * With `createMissingFolders`, a folder that doesn't exist yet is made (with any missing
   * folders above it) once every other check has passed; without it, it is refused.
   */
  createWorkspace(input: {
    name?: string;
    folder: string;
    createMissingFolders?: boolean;
  }) {
    const folder = resolve(input.folder);
    if (!input.createMissingFolders) assertDirectory(folder);
    this.assertFolderFree(folder);
    const explicit = input.name?.trim();
    if (explicit) this.assertWorkspaceNameFree(explicit);
    if (input.createMissingFolders) makeFolders(folder);
    const name = explicit || availableName(basename(folder), this.workspaceNames());
    // The Prime and Worker are recorded with the Workspace and started only when asked to.
    const { id } = this.store.transaction(() => {
      const workspace = this.store.addWorkspace({ name, folder });
      for (const role of ROLES) {
        this.store.addSession({
          id: randomUUID(),
          workspaceId: workspace.id,
          name: ROLE_NAMES[role],
          role,
          conversationId: randomUUID(),
          launchOptions: ROLE_LAUNCH_OPTIONS[role],
        });
      }
      return workspace;
    });
    return { id, name, folder };
  }

  /**
   * Where the folder picker opens: the parent of the most recently created Workspace's
   * folder, or `root` (Home) when there is none or that parent is gone.
   */
  pickerStart(root: string): string {
    const newest = this.store.newestWorkspace();
    const parent = newest && dirname(newest.folder);
    return parent && isDirectory(parent) ? parent : root;
  }

  /**
   * Renames and/or re-folders a Workspace; both changes are checked before either is made.
   * `createMissingFolders` works as in `createWorkspace`. Moving the Open Workspace onto a
   * folder starts its Stopped Prime and Worker there, so fixing a Missing one needs no
   * second open.
   */
  async updateWorkspace(
    id: string,
    changes: { name?: string; folder?: string; createMissingFolders?: boolean },
  ) {
    const workspace = this.store.getWorkspace(id);
    if (!workspace) throw new ServiceError("not_found", "Unknown Workspace");
    const update: { name?: string; folder?: string } = {};
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (!name) throw new ServiceError("invalid", "name must not be blank");
      this.assertWorkspaceNameFree(name, id);
      update.name = name;
    }
    if (changes.folder !== undefined) {
      const folder = resolve(changes.folder);
      if (!changes.createMissingFolders) assertDirectory(folder);
      this.assertFolderFree(folder, id);
      update.folder = folder;
    }
    if (update.folder !== undefined && changes.createMissingFolders) {
      makeFolders(update.folder);
    }
    this.store.updateWorkspace(id, update);
    if (update.folder !== undefined && this.openWorkspaceId() === id) {
      await this.startRoles(id);
    }
    return { ...workspace, ...update };
  }

  /**
   * Makes the Workspace the Open Workspace and, unless it is Missing, starts its Stopped
   * Prime and Worker, resuming their conversations. Opening it again changes nothing that
   * is running. With `showWorker` (the owner chose it by name), its right Pane shows the
   * Worker again, keeping its tabs.
   */
  async openWorkspace(
    id: string,
    options: { showWorker?: boolean } = {},
  ): Promise<{ id: string }> {
    const workspace = this.store.getWorkspace(id);
    if (!workspace) throw new ServiceError("not_found", "Unknown Workspace");
    this.store.transaction(() => {
      this.store.setOpenWorkspaceId(id);
      if (options.showWorker) {
        this.store.setRightPane(id, { ...this.rightPane(id), shown: null });
      }
    });
    if (isDirectory(workspace.folder)) await this.startRoles(id);
    return { id };
  }

  /**
   * The Open Workspace: the one last opened or, when none is set, the first by position.
   * Null when there are no Workspaces.
   */
  private openWorkspaceId(): string | null {
    return this.store.getOpenWorkspaceId() ?? this.store.listWorkspaces()[0]?.id ?? null;
  }

  /** Starts the Workspace's Prime and Worker, those that are Stopped, together. */
  private async startRoles(workspaceId: string): Promise<void> {
    const { primeAndWorker } = sessionsByRole(this.store.listSessions(workspaceId));
    await Promise.all(primeAndWorker.map((session) => this.restartSession(session.id)));
  }

  /**
   * Sets what the Workspace's right Pane holds. Every tab must be one of its Other Sessions,
   * once, and what's shown must be one of the tabs, or null for the Worker.
   */
  setRightPane(workspaceId: string, rightPane: RightPaneState): void {
    if (!this.store.getWorkspace(workspaceId)) {
      throw new ServiceError("not_found", "Unknown Workspace");
    }
    const others = this.otherSessionIds(workspaceId);
    const { shown, tabs } = rightPane;
    if (!tabs.every((id) => others.has(id)) || new Set(tabs).size !== tabs.length) {
      throw new ServiceError(
        "invalid",
        "tabs must list Other Sessions of the Workspace, each at most once",
      );
    }
    if (shown !== null && !tabs.includes(shown)) {
      throw new ServiceError("invalid", "shown must be null or one of the tabs");
    }
    this.store.setRightPane(workspaceId, { shown, tabs });
  }

  private otherSessionIds(workspaceId: string): Set<string> {
    const { others } = sessionsByRole(this.store.listSessions(workspaceId));
    return new Set(others.map((session) => session.id));
  }

  /**
   * What the Workspace's right Pane holds, leaving out any Session that is no longer one of
   * its Other Sessions.
   */
  private rightPane(workspaceId: string): RightPaneState {
    const others = this.otherSessionIds(workspaceId);
    const stored = this.store.getRightPane(workspaceId);
    const tabs = stored.tabs.filter((id) => others.has(id));
    const shown =
      stored.shown !== null && tabs.includes(stored.shown) ? stored.shown : null;
    return { shown, tabs };
  }

  /** `ids` must be every Workspace exactly once, in the order the owner wants. */
  reorderWorkspaces(ids: string[]): void {
    const known = this.store.listWorkspaces().map((w) => w.id);
    if (ids.length !== known.length || !known.every((id) => ids.includes(id))) {
      throw new ServiceError("invalid", "ids must list every Workspace exactly once");
    }
    this.store.setWorkspaceOrder(ids);
  }

  /**
   * `ids` must be every Other Session of the Workspace exactly once, in the order the owner
   * wants. The Prime and Worker always come first, so they are never in it.
   */
  reorderSessions(workspaceId: string, ids: string[]): void {
    if (!this.store.getWorkspace(workspaceId)) {
      throw new ServiceError("not_found", "Unknown Workspace");
    }
    const known = [...this.otherSessionIds(workspaceId)];
    if (ids.length !== known.length || !known.every((id) => ids.includes(id))) {
      throw new ServiceError(
        "invalid",
        "ids must list every Other Session of the Workspace exactly once",
      );
    }
    this.store.setSessionOrder(workspaceId, ids);
  }

  /**
   * Ends the Workspace's shells first, then forgets it. The folder on disk is never touched.
   * Deleting the Open Workspace opens the first Workspace by position, or none.
   */
  async deleteWorkspace(id: string): Promise<void> {
    if (!this.store.getWorkspace(id))
      throw new ServiceError("not_found", "Unknown Workspace");
    const ids = this.store.listSessions(id).map((session) => session.id);
    // Every shell gets its kill, even if one fails; a failure keeps the Workspace so the
    // owner can retry (killing is idempotent), instead of leaving a half-killed one.
    const kills = await Promise.allSettled(
      ids.map((sessionId) => this.tmux.killSession(sessionId)),
    );
    const failed = kills.find((kill) => kill.status === "rejected");
    if (failed) throw failed.reason;
    const wasOpen = this.openWorkspaceId() === id;
    this.store.transaction(() => {
      this.store.deleteWorkspace(id);
      // The first Workspace by position becomes open, and stays so through a reorder. It is
      // not started: only opening it does that.
      if (wasOpen)
        this.store.setOpenWorkspaceId(this.store.listWorkspaces()[0]?.id ?? null);
    });
  }

  private workspaceNames(exceptId?: string): Set<string> {
    return new Set(
      this.store
        .listWorkspaces()
        .filter((w) => w.id !== exceptId)
        .map((w) => w.name),
    );
  }

  /** Workspace names are unique. Renaming reuses this, passing the Workspace being renamed. */
  private assertWorkspaceNameFree(name: string, exceptId?: string): void {
    if (this.workspaceNames(exceptId).has(name)) {
      throw new ServiceError("conflict", `A Workspace named "${name}" already exists`);
    }
  }

  /**
   * A folder has at most one Workspace, so a project never gets two sets of Claudes. The
   * refusal names the Workspace that has it, so a client can take the owner there.
   * `folder` is already resolved. Changing a folder passes the Workspace being moved.
   */
  private assertFolderFree(folder: string, exceptId?: string): void {
    const owner = this.store
      .listWorkspaces()
      .find((w) => w.id !== exceptId && resolve(w.folder) === folder);
    if (owner) {
      throw new ServiceError(
        "conflict",
        `A Workspace for this folder already exists: "${owner.name}"`,
        { workspace: { id: owner.id, name: owner.name } },
      );
    }
  }

  /**
   * One at a time: choosing the name and storing the Session are separated by starting
   * the shell, so overlapping creations would otherwise pick the same default name.
   */
  createSession(
    workspaceId: string,
    requestedName?: string,
    /** Makes it a Claude Session started with these Launch options. */
    launchOptions?: LaunchOptions,
  ) {
    const result = this.sessionCreations.then(() =>
      this.createSessionNow(workspaceId, requestedName, launchOptions),
    );
    this.sessionCreations = result.catch(() => undefined);
    return result;
  }

  private async createSessionNow(
    workspaceId: string,
    requestedName: string | undefined,
    launchOptions: LaunchOptions | undefined,
  ) {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) throw new ServiceError("not_found", "Unknown Workspace");
    if (!isDirectory(workspace.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${workspace.folder}`);
    }
    const taken = new Set(this.store.listSessions(workspaceId).map((s) => s.name));
    let name = requestedName?.trim();
    if (!name) {
      let n = 1;
      while (taken.has(`session ${n}`)) n++;
      name = `session ${n}`;
    } else if (taken.has(name) || isRoleName(name)) {
      throw new ServiceError("conflict", `A Session named "${name}" already exists`);
    }
    const id = randomUUID();
    // k-bench chooses the Claude conversation's ID, so a restart can name it (ADR-0005).
    const claude: ClaudeLaunch | undefined = launchOptions && {
      conversationId: randomUUID(),
      options: launchOptions,
      mode: "start",
    };
    await this.reconciler.whileStarting(id, async () => {
      await this.tmux.createSession(id, workspace.folder, claude);
      try {
        this.store.addSession({
          id,
          workspaceId,
          name,
          conversationId: claude?.conversationId,
          launchOptions: claude?.options,
        });
      } catch (error) {
        await this.tmux.killSession(id);
        throw error;
      }
    });
    // Remembered for the next New Claude dialog, on any device.
    if (launchOptions) this.store.setLastLaunchOptions(launchOptions);
    return { id, name };
  }

  /** The Launch options last used for a Claude Session; all Default, Focus view off, if none. */
  lastLaunchOptions(): LaunchOptions {
    return this.store.getLastLaunchOptions() ?? DEFAULT_LAUNCH_OPTIONS;
  }

  renameSession(sessionId: string, requestedName: string): { id: string; name: string } {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    assertNoRole(session, "renamed");
    const name = requestedName.trim();
    if (!name) throw new ServiceError("invalid", "name is required");
    const clash = this.store
      .listSessions(session.workspaceId)
      .some((other) => other.id !== sessionId && other.name === name);
    if (clash || isRoleName(name)) {
      throw new ServiceError("conflict", `A Session named "${name}" already exists`);
    }
    this.store.renameSession(sessionId, name);
    return { id: sessionId, name };
  }

  /**
   * Ends the Session's shell and everything in it, then forgets the Session, and its tab in
   * the right Pane, which shows the Worker if that tab was shown.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    assertNoRole(session, "deleted");
    await this.tmux.killSession(sessionId);
    this.store.transaction(() => {
      this.store.deleteSession(sessionId);
      this.store.setRightPane(session.workspaceId, this.rightPane(session.workspaceId));
    });
  }

  async getState(): Promise<State> {
    const live = await this.reconciler.reconcile();
    await this.decayQuietWork(live);
    return {
      openWorkspaceId: this.openWorkspaceId(),
      workspaces: this.store.listWorkspaces().map((workspace) => ({
        ...workspace,
        missing: !isDirectory(workspace.folder),
        sessions: this.store.listSessions(workspace.id).map((session) => ({
          id: session.id,
          name: session.name,
          kind: session.kind,
          role: session.role,
          status: live.has(session.id) ? "running" : "stopped",
          bell: live.get(session.id)?.bell ?? false,
          activity: activityOf(session, live.get(session.id)),
        })),
        rightPane: this.rightPane(workspace.id),
      })),
    };
  }

  /**
   * Makes Idle each Working Session that has printed nothing for the quiet time: Claude Code
   * fires no hook when a turn is interrupted, and a wrong Idle is better than a wrong Working.
   * The Idle is written back to tmux, so it latches: the redraws an idle Claude Code makes
   * now and then don't bring Working back, and only a hook or the owner's key moves it on.
   * Waiting never decays, since a permission prompt doesn't redraw.
   */
  private async decayQuietWork(live: Map<string, LiveSession>): Promise<void> {
    const working: SessionActivity = "working";
    const quietSince = Math.floor((Date.now() - this.workingQuietMs) / 1000);
    await Promise.all(
      [...live.values()]
        .filter(
          (session) => session.activity === working && session.lastChange <= quietSince,
        )
        .map(async (session) => {
          const activity = await this.tmux.decayWorking(session.id, quietSince);
          if (activity !== undefined) session.activity = activity;
        }),
    );
  }

  /**
   * Gives a Stopped Session a fresh program in its Workspace folder, keeping its id and name:
   * a shell, or Claude Code for a Claude Session.
   * A Session that is already running is left alone.
   */
  async restartSession(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    // Two restarts of the same Session (a double click) share one start.
    let restart = this.restarts.get(sessionId);
    if (!restart) {
      restart = this.startStopped(session).finally(() => this.restarts.delete(sessionId));
      this.restarts.set(sessionId, restart);
    }
    await restart;
    return { id: session.id, name: session.name };
  }

  private async startStopped(session: {
    id: string;
    folder: string;
    role: SessionRole | null;
    conversationId: string | null;
    launchOptions: LaunchOptions | null;
  }): Promise<void> {
    if ((await this.tmux.listSessions()).some((live) => live.id === session.id)) return;
    if (!isDirectory(session.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${session.folder}`);
    }
    await this.reconciler.whileStarting(session.id, () =>
      this.tmux.createSession(
        session.id,
        session.folder,
        session.conversationId === null
          ? undefined
          : {
              conversationId: session.conversationId,
              mode: "resume",
              // Every Launch option is passed again each time (ADR-0005). A Prime's or
              // Worker's are k-bench's fixed ones, whatever was stored with it.
              options: session.role
                ? ROLE_LAUNCH_OPTIONS[session.role]
                : (session.launchOptions ?? DEFAULT_LAUNCH_OPTIONS),
            },
      ),
    );
  }

  /** Whether the terminal WebSocket has a shell to attach to: a known Session that is running. */
  async hasRunningShell(sessionId: string): Promise<boolean> {
    if (!this.store.getSession(sessionId)) return false;
    const live = await this.tmux.listSessions();
    return live.some((s) => s.id === sessionId);
  }
}
