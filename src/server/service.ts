import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { conversationOf } from "../agent/conversation.ts";
import type { ImageMediaType } from "../shared/agent-images.ts";
import { DEFAULT_LAUNCH_OPTIONS, type LaunchOptions } from "../shared/launch-options.ts";
import type { ClaudeInterface, NewSessionKind, State } from "../shared/state-protocol.ts";
import { ImageError, readAgentImage, storeAgentImage } from "./agent-images.ts";
import type { AgentStatuses } from "./agent-status.ts";
import { type AgentRuntimes, AgentStartError } from "./agents.ts";
import type { ClaudeLaunch } from "./claude.ts";
import { searchFiles } from "./file-search.ts";
import { availableName } from "./naming.ts";
import { Reconciler } from "./reconciler.ts";
import type { Store, UnsupportedEntry } from "./store.ts";
import type { TmuxDriver } from "./tmux.ts";

/** A failure the HTTP layer maps to a status code. */
export class ServiceError extends Error {
  readonly kind: "not_found" | "conflict" | "invalid";

  constructor(kind: "not_found" | "conflict" | "invalid", message: string) {
    super(message);
    this.kind = kind;
  }
}

const unknownAgent = () => new ServiceError("not_found", "Unknown Claude Agent");

/** The longest kind or occurrence id a browser may report: a bound on what a client can store. */
const MAX_REPORT_FIELD = 300;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What makes a new Session a Claude Session: its Launch options and its interface. */
export interface ClaudeSessionRequest {
  options: LaunchOptions;
  interface: ClaudeInterface;
}

/** The domain operations. The store holds what the owner chose; tmux says what is alive. */
export class Service {
  private readonly store: Store;
  private readonly tmux: TmuxDriver;
  private readonly agents: AgentRuntimes;
  private readonly statuses: AgentStatuses;
  private sessionCreations: Promise<unknown> = Promise.resolve();
  private readonly reconciler: Reconciler;
  private readonly restarts = new Map<string, Promise<void>>();
  /** The Agents `restartAgent` is moving to a new runtime: running, as far as Panes know. */
  private readonly replacing = new Set<string>();

  constructor(
    store: Store,
    tmux: TmuxDriver,
    agents: AgentRuntimes,
    statuses: AgentStatuses,
  ) {
    this.store = store;
    this.tmux = tmux;
    this.agents = agents;
    this.statuses = statuses;
    // `/clear` moves an Agent to a new conversation: a Restart resumes the one it is in.
    statuses.onConversation((sessionId, conversationId) => {
      if (this.store.getSession(sessionId)?.conversationId !== conversationId) {
        this.store.setConversationId(sessionId, conversationId);
      }
    });
    this.reconciler = new Reconciler(store, tmux);
  }

  /** Kills tmux sessions that have no store record. Runs at startup and on every state read. */
  async reconcile(): Promise<void> {
    await this.reconciler.reconcile();
  }

  /**
   * Deletes the Agent folders whose Session is gone. Only at startup, after `reconcile` has
   * ended the runtimes of such Sessions: a folder is made before its row, so on a running
   * server this could take the folder of an Agent being created.
   */
  removeStrayAgentFolders(): void {
    this.agents.removeStrayFolders((id) => this.store.getSession(id) !== undefined);
  }

  createWorkspace(input: { name?: string; folder: string }) {
    const folder = resolve(input.folder);
    if (!isDirectory(folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${folder}`);
    }
    const explicit = input.name?.trim();
    if (explicit) this.assertWorkspaceNameFree(explicit);
    const name = explicit || availableName(basename(folder), this.workspaceNames());
    const { id } = this.store.addWorkspace({ name, folder });
    return { id, name, folder };
  }

  /** Renames and/or re-folders a Workspace; both changes are checked before either is made. */
  updateWorkspace(id: string, changes: { name?: string; folder?: string }) {
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
      if (!isDirectory(folder)) {
        throw new ServiceError("invalid", `Folder does not exist: ${folder}`);
      }
      update.folder = folder;
    }
    this.store.updateWorkspace(id, update);
    return { ...workspace, ...update };
  }

  /** `ids` must be every Workspace exactly once, in the order the owner wants. */
  reorderWorkspaces(ids: string[]): void {
    const known = this.store.listWorkspaces().map((w) => w.id);
    if (ids.length !== known.length || !known.every((id) => ids.includes(id))) {
      throw new ServiceError("invalid", "ids must list every Workspace exactly once");
    }
    this.store.setWorkspaceOrder(ids);
  }

  /** Ends the Workspace's shells first, then forgets it. The folder on disk is never touched. */
  async deleteWorkspace(id: string): Promise<void> {
    if (!this.store.getWorkspace(id))
      throw new ServiceError("not_found", "Unknown Workspace");
    const sessions = this.store.listSessions(id);
    // Every Session gets its end, even if one fails; a failure keeps the Workspace so the
    // owner can retry (ending is idempotent), instead of leaving a half-ended one.
    const ends = await Promise.allSettled(
      sessions.map((session) => this.endSession(session)),
    );
    const failed = ends.find((end) => end.status === "rejected");
    if (failed) throw failed.reason;
    this.store.deleteWorkspace(id);
    for (const session of sessions) {
      // A Claude Session that was an Agent once keeps its folder in the terminal too.
      if (session.kind === "claude") this.agents.removeFolder(session.id);
    }
  }

  /**
   * Ends a Session's program and everything in it. A Claude Agent's runtime is asked to shut
   * down first, so its log is finished and its Claude Code closed before its tmux session goes.
   */
  private async endSession(session: {
    id: string;
    interface: ClaudeInterface | null;
  }): Promise<void> {
    if (session.interface === "agent") await this.agents.shutdown(session.id);
    else await this.tmux.killSession(session.id);
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
   * One at a time: choosing the name and storing the Session are separated by starting
   * the shell, so overlapping creations would otherwise pick the same default name.
   */
  createSession(
    workspaceId: string,
    requestedName?: string,
    /** Makes it a Claude Session, started with these Launch options in this interface. */
    claude?: ClaudeSessionRequest,
  ) {
    const result = this.sessionCreations.then(() =>
      this.createSessionNow(workspaceId, requestedName, claude),
    );
    this.sessionCreations = result.catch(() => undefined);
    return result;
  }

  private async createSessionNow(
    workspaceId: string,
    requestedName: string | undefined,
    request: ClaudeSessionRequest | undefined,
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
    } else if (taken.has(name)) {
      throw new ServiceError("conflict", `A Session named "${name}" already exists`);
    }
    const id = randomUUID();
    // k-bench chooses the Claude conversation's ID, so a restart can name it (ADR-0005).
    const claude: ClaudeLaunch | undefined = request && {
      conversationId: randomUUID(),
      options: request.options,
      mode: "start",
    };
    const agent = request?.interface === "agent";
    await this.reconciler.whileStarting(id, async () => {
      try {
        if (claude && agent) {
          await this.agents.launch({
            sessionId: id,
            workspaceFolder: workspace.folder,
            conversationId: claude.conversationId,
            mode: "start",
            options: claude.options,
          });
        } else {
          await this.tmux.createSession(id, workspace.folder, claude);
        }
      } catch (error) {
        if (agent) this.agents.removeFolder(id);
        throw error instanceof AgentStartError
          ? new ServiceError("invalid", `Claude Agent could not start: ${error.message}`)
          : error;
      }
      try {
        this.store.addSession({
          id,
          workspaceId,
          name,
          conversationId: claude?.conversationId,
          launchOptions: claude?.options,
          interface: request?.interface,
        });
      } catch (error) {
        await this.endSession({ id, interface: request?.interface ?? null });
        if (agent) this.agents.removeFolder(id);
        throw error;
      }
    });
    if (agent) await this.finishStartingAgent(id, "create");
    // Remembered for the next New Session dialog, on any device. A shell leaves the Launch
    // options as they were, so switching the dialog back to Claude finds them; a Claude TUI
    // and a Claude Agent share them.
    this.store.setLastSessionKind(
      !request ? "shell" : request.interface === "agent" ? "claude-agent" : "claude",
    );
    if (request) this.store.setLastLaunchOptions(request.options);
    return { id, name };
  }

  /**
   * Waits for a Claude Agent's runtime to come up. If it does not, the Agent is undone as
   * far as `step` got (a new Session is deleted; a restarted one stays Stopped) and the
   * reason the runtime recorded is the refusal.
   */
  private async finishStartingAgent(id: string, step: "create" | "restart") {
    try {
      await this.agents.waitUntilReady(id);
    } catch (error) {
      await this.agents.shutdown(id);
      if (step === "create") {
        this.store.deleteSession(id);
        this.agents.removeFolder(id);
      }
      const why = error instanceof Error ? error.message : String(error);
      throw new ServiceError("invalid", `Claude Agent could not start: ${why}`);
    }
  }

  /**
   * What the New Session dialog opens on: the kind of Session created last, and the Launch
   * options last used for a Claude Session. A shell, and all Default with Focus view off, if
   * none has been created.
   */
  lastNewSession(): { kind: NewSessionKind; claude: LaunchOptions } {
    return {
      kind: this.store.getLastSessionKind() ?? "shell",
      claude: this.store.getLastLaunchOptions() ?? DEFAULT_LAUNCH_OPTIONS,
    };
  }

  /**
   * Counts an occurrence of an unsupported kind a browser saw in a Session (#154). The
   * `occurrenceId` is the browser's name for the occurrence, the same from every device, so a
   * report that arrives twice counts once. `at` is when it happened, if the browser knows.
   */
  reportUnsupported(input: {
    kind: unknown;
    sessionId: unknown;
    occurrenceId: unknown;
    at: unknown;
  }): void {
    const { kind, sessionId, occurrenceId } = input;
    if (typeof kind !== "string" || kind === "" || kind.length > MAX_REPORT_FIELD) {
      throw new ServiceError("invalid", "kind is required");
    }
    if (
      typeof occurrenceId !== "string" ||
      occurrenceId === "" ||
      occurrenceId.length > MAX_REPORT_FIELD
    ) {
      throw new ServiceError("invalid", "occurrenceId is required");
    }
    if (typeof sessionId !== "string" || !this.store.getSession(sessionId)) {
      throw new ServiceError("not_found", "Unknown Session");
    }
    const now = Date.now();
    const at =
      typeof input.at === "number" && Number.isFinite(input.at)
        ? Math.min(Math.round(input.at), now)
        : now;
    this.store.recordUnsupported({ kind, sessionId, occurrenceId, at });
  }

  /** The running list of unsupported kinds, latest first. */
  listUnsupported(): UnsupportedEntry[] {
    return this.store.listUnsupported();
  }

  clearUnsupported(kind: string): void {
    this.store.clearUnsupported(kind);
  }

  /** The Session, or the 404 that says there is none. */
  private requireSession(sessionId: string) {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ServiceError("not_found", "Unknown Session");
    return session;
  }

  /**
   * The Session, which must be a Claude Agent. With `refusal` (what the operation needs), a
   * Session that is not one is a 422 saying so, and an unknown Session is a 404. Without it,
   * neither is told apart: both are "Unknown Claude Agent", for routes that only ever name an
   * Agent's own files.
   */
  private requireAgent(sessionId: string, refusal?: string) {
    if (refusal === undefined) {
      const session = this.store.getSession(sessionId);
      if (session?.interface !== "agent") throw unknownAgent();
      return session;
    }
    const session = this.requireSession(sessionId);
    if (session.interface !== "agent") throw new ServiceError("invalid", refusal);
    return session;
  }

  /**
   * Runs `start` unless one is already in flight for the Session, and waits for it: a double
   * tap, or another device doing the same, shares one switch or restart. `replacing` keeps the
   * Agent counting as running, for its Panes, until it is done (see `replacing`).
   */
  private sharedSwitch(
    sessionId: string,
    start: () => Promise<void>,
    options: { replacing?: boolean } = {},
  ): Promise<void> {
    let inFlight = this.restarts.get(sessionId);
    if (!inFlight) {
      if (options.replacing) this.replacing.add(sessionId);
      inFlight = start().finally(() => {
        this.restarts.delete(sessionId);
        if (options.replacing) this.replacing.delete(sessionId);
      });
      this.restarts.set(sessionId, inFlight);
    }
    return inFlight;
  }

  renameSession(sessionId: string, requestedName: string): { id: string; name: string } {
    const session = this.requireSession(sessionId);
    const name = requestedName.trim();
    if (!name) throw new ServiceError("invalid", "name is required");
    const clash = this.store
      .listSessions(session.workspaceId)
      .some((other) => other.id !== sessionId && other.name === name);
    if (clash) {
      throw new ServiceError("conflict", `A Session named "${name}" already exists`);
    }
    this.store.renameSession(sessionId, name);
    return { id: sessionId, name };
  }

  /**
   * Stops a Claude Agent: its runtime is told to shut down (it interrupts the turn, closes
   * any open ask as not answered, finishes the log), and killed if it does not. The Session
   * stays, Stopped, with its Transcript readable and Restart to carry on. Stopping one that
   * is already Stopped does nothing.
   */
  async stopSession(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.requireAgent(sessionId, "Only a Claude Agent can be stopped");
    await this.agents.shutdown(sessionId);
    return { id: session.id, name: session.name };
  }

  /**
   * Switches a Claude Agent to a Claude TUI, in the same Session: the runtime is shut down
   * cleanly (a Stopped Agent has none), then Claude Code starts in the terminal on the same
   * conversation with the same Launch options, exactly as a Claude TUI restarts. Every
   * device follows, because the state says the Session is in the terminal now. The Agent's
   * folder stays: its log is what Open in web resumes from.
   */
  async openInTerminal(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.requireAgent(
      sessionId,
      "Only a Claude Agent can be opened in the terminal",
    );
    // A double tap, or another device doing the same, shares one switch.
    await this.sharedSwitch(sessionId, () => this.switchToTerminal(sessionId));
    return { id: session.id, name: session.name };
  }

  private async switchToTerminal(sessionId: string): Promise<void> {
    await this.agents.shutdown(sessionId);
    // Read after the shutdown: the conversation may have changed (`/clear`) until the runtime
    // ended. The stored ID is only fresh while the server follows the Agent's status, so the
    // log, now final, says which conversation the Agent is in.
    const session = this.store.getSession(sessionId);
    if (session?.interface !== "agent") return;
    if (session.conversationId !== null) {
      const { id } = conversationOf(
        session.conversationId,
        this.agents.readLog(sessionId).readAfter(0),
      );
      if (id !== session.conversationId) {
        this.store.setConversationId(sessionId, id);
        session.conversationId = id;
      }
    }
    // The terminal must not attach to the runtime's hidden tmux session, so the interface
    // changes only once that session is gone.
    this.store.setInterface(sessionId, "tui");
    try {
      await this.startStopped({ ...session, interface: "tui" });
    } catch (error) {
      // Still an Agent, Stopped, with its Transcript and Restart.
      this.store.setInterface(sessionId, "agent");
      throw error;
    }
  }

  /**
   * Switches a Claude TUI back to a Claude Agent, in the same Session (#156): the terminal's
   * tmux session is stopped, then the Agent Runtime starts on the same conversation and, before
   * Claude Code does, imports what the terminal did (ADR-0008). The terminal may be mid-turn:
   * k-bench cannot tell, so the browser always asks first, unless the Claude TUI is Stopped,
   * which has nothing to end. Every device follows, because the state says it is an Agent now.
   */
  async openInWeb(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.requireSession(sessionId);
    if (session.kind !== "claude" || session.interface !== "tui") {
      throw new ServiceError("invalid", "Only a Claude TUI can be opened in web");
    }
    // A double tap, or another device doing the same, shares one switch.
    await this.sharedSwitch(sessionId, () => this.switchToWeb(sessionId), {
      replacing: true,
    });
    return { id: session.id, name: session.name };
  }

  private async switchToWeb(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (session?.interface !== "tui") return;
    if (session.conversationId === null) {
      throw new ServiceError("invalid", "This Session has no conversation to open");
    }
    // Checked before the terminal goes: what would stop the Agent starting must not cost the
    // owner a terminal that was fine.
    if (!isDirectory(session.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${session.folder}`);
    }
    if (!this.agents.current && !this.agents.install()) {
      throw new ServiceError(
        "invalid",
        "Claude Agents are not available on this install",
      );
    }
    // Gone before the interface changes, as in the other direction: while the Session is a
    // Claude Agent and a terminal's tmux session still exists, nothing may attach to it.
    await this.tmux.killSession(sessionId);
    this.store.setInterface(sessionId, "agent");
    try {
      await this.startStopped(
        { ...session, interface: "agent" },
        { importTerminal: true },
      );
    } catch (error) {
      // The terminal is gone and the Agent did not start: a Stopped Claude TUI, which Restart
      // starts again on the same conversation.
      this.store.setInterface(sessionId, "tui");
      throw error;
    }
  }

  /** Ends the Session's shell and everything in it, then forgets the Session. */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await this.endSession(session);
    this.store.deleteSession(sessionId);
    // Last: the runtime has gone and the row with it, so nothing can write here again.
    if (session.kind === "claude") this.agents.removeFolder(sessionId);
  }

  async getState(): Promise<State> {
    const live = await this.reconciler.reconcile();
    const workspaces = this.store.listWorkspaces().map((workspace) => ({
      ...workspace,
      sessions: this.store.listSessions(workspace.id),
    }));
    // A Claude Agent that runs is watched, so what it is doing can be reported below.
    const running = new Set(
      workspaces.flatMap((workspace) =>
        workspace.sessions
          .filter((session) => session.interface === "agent" && live.has(session.id))
          .map((session) => session.id),
      ),
    );
    this.statuses.follow(running);
    // A runtime build's folder goes once no running Agent has been heard to use it.
    const builds = this.statuses.buildsInUse(running);
    if (builds) this.agents.pruneRuntimes(builds);
    return {
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        missing: !isDirectory(workspace.folder),
        sessions: workspace.sessions.map((session) => {
          const agent =
            session.interface === "agent" && live.has(session.id)
              ? this.statuses.stateOf(session.id)
              : undefined;
          return {
            id: session.id,
            name: session.name,
            kind: session.kind,
            ...(session.interface ? { interface: session.interface } : {}),
            status: live.has(session.id) ? ("running" as const) : ("stopped" as const),
            ...(agent ? { agent } : {}),
            // An Agent's Bell is its runtime's (no terminal rings one); a terminal's is tmux's.
            bell:
              session.interface === "agent"
                ? agent !== undefined && this.statuses.bellOf(session.id)
                : (live.get(session.id)?.bell ?? false),
          };
        }),
      })),
    };
  }

  /**
   * Starts watching the Claude Agents that run (see `getState`) and waits briefly for what
   * each says, so that the first state a restarted server shows already has it.
   */
  async watchAgents(): Promise<void> {
    await this.getState();
    await this.statuses.settled(3_000);
    // Each Agent has now said which runtime build it runs: old builds nothing runs go.
    await this.getState();
  }

  /**
   * Restarts a running Claude Agent on the runtime build installed now, carrying on its
   * conversation: how an Agent moves to a new k-bench's runtime, or past a runtime whose
   * protocol this k-bench does not speak. The owner's call, never automatic. Like Stop it
   * interrupts a turn that is running. The Agent's Panes stay connected through it: until it
   * is up again the Agent still counts as running, so they wait for the new runtime instead
   * of being told the Session ended. A Stopped Agent is simply started, as Restart does.
   */
  async restartAgent(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.requireAgent(
      sessionId,
      "Only a Claude Agent can be restarted this way",
    );
    await this.sharedSwitch(
      sessionId,
      async () => {
        await this.agents.shutdown(sessionId);
        await this.startStopped(session);
      },
      { replacing: true },
    );
    return { id: session.id, name: session.name };
  }

  /**
   * Gives a Stopped Session a fresh program in its Workspace folder, keeping its id and name:
   * a shell, or Claude Code for a Claude Session.
   * A Session that is already running is left alone.
   */
  async restartSession(sessionId: string): Promise<{ id: string; name: string }> {
    const session = this.requireSession(sessionId);
    // Two restarts of the same Session (a double click) share one start.
    await this.sharedSwitch(sessionId, () => this.startStopped(session));
    return { id: session.id, name: session.name };
  }

  private async startStopped(
    session: {
      id: string;
      folder: string;
      conversationId: string | null;
      launchOptions: LaunchOptions | null;
      interface: ClaudeInterface | null;
    },
    /** Open in web: the runtime imports the terminal's turns before Claude Code starts. */
    options: { importTerminal?: boolean } = {},
  ): Promise<void> {
    if ((await this.tmux.listSessions()).some((live) => live.id === session.id)) return;
    if (!isDirectory(session.folder)) {
      throw new ServiceError("invalid", `Folder does not exist: ${session.folder}`);
    }
    if (session.interface === "agent" && session.conversationId !== null) {
      const { id, folder, conversationId, launchOptions } = session;
      await this.reconciler.whileStarting(id, async () => {
        try {
          await this.agents.launch({
            sessionId: id,
            workspaceFolder: folder,
            conversationId,
            mode: "resume",
            // Every Launch option is passed again each time (ADR-0005).
            options: launchOptions ?? DEFAULT_LAUNCH_OPTIONS,
            ...(options.importTerminal ? { importTerminal: true } : {}),
          });
        } catch (error) {
          throw error instanceof AgentStartError
            ? new ServiceError(
                "invalid",
                `Claude Agent could not start: ${error.message}`,
              )
            : error;
        }
      });
      await this.finishStartingAgent(id, "restart");
      return;
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
              // Every Launch option is passed again each time (ADR-0005).
              options: session.launchOptions ?? DEFAULT_LAUNCH_OPTIONS,
            },
      ),
    );
  }

  /**
   * Whether the terminal WebSocket has a shell to attach to: a known Session that is running.
   * Never a Claude Agent, whose tmux session is hidden: no terminal attaches to it (ADR-0007).
   */
  async hasRunningShell(sessionId: string): Promise<boolean> {
    const session = this.store.getSession(sessionId);
    if (!session || session.interface === "agent") return false;
    const live = await this.tmux.listSessions();
    return live.some((s) => s.id === sessionId);
  }

  /** The Agent's folder, or the error that says the Session is not a Claude Agent. */
  private agentFolderOf(sessionId: string): string {
    this.requireAgent(sessionId);
    return this.agents.folder(sessionId);
  }

  /** Keeps an image for the Agent's next prompt and returns the name the prompt uses. */
  saveAgentImage(sessionId: string, mediaType: unknown, base64: unknown): string {
    const folder = this.agentFolderOf(sessionId);
    try {
      return storeAgentImage(folder, mediaType, base64);
    } catch (error) {
      if (error instanceof ImageError) throw new ServiceError("invalid", error.message);
      // The Agent's folder went with its Session, between the check and the write.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw unknownAgent();
      }
      throw error;
    }
  }

  /** An image an Agent's prompt carried, for showing it again. */
  agentImage(
    sessionId: string,
    name: string,
  ): { bytes: Buffer; mediaType: ImageMediaType } {
    const image = readAgentImage(this.agentFolderOf(sessionId), name);
    if (!image) throw new ServiceError("not_found", "Unknown image");
    return image;
  }

  /**
   * The files in a Claude Agent's Workspace folder whose names match, for the `@` picker:
   * relative paths, git-ignored files left out, capped (`searchFiles`).
   */
  async searchAgentFiles(sessionId: string, query: string): Promise<string[]> {
    return searchFiles(this.requireAgent(sessionId).folder, query);
  }

  /** Whether the Session is a Claude Agent, running or not. */
  isAgent(sessionId: string): boolean {
    return this.store.getSession(sessionId)?.interface === "agent";
  }

  /** Whether the agent WebSocket has a runtime to relay to: a known Claude Agent that is running. */
  async hasRunningAgent(sessionId: string): Promise<boolean> {
    if (this.store.getSession(sessionId)?.interface !== "agent") return false;
    return this.replacing.has(sessionId) || this.agents.isRunning(sessionId);
  }
}
