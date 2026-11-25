import type { Store } from "./store.ts";
import type { LiveSession, TmuxDriver } from "./tmux.ts";

/** A conversation ID as Claude Code makes them. Anything else a hook reports is ignored. */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compares the store with what is alive in tmux (ADR-0002). A Session in the store with no
 * live tmux session is Stopped, which callers learn from the returned live ids. A live tmux
 * session on this instance's socket with no store row is an orphan and is killed. A live
 * Claude Session whose Claude Code reported moving to another conversation has the new one
 * stored, so a restart resumes it (ADR-0005).
 */
export class Reconciler {
  private readonly store: Store;
  private readonly tmux: TmuxDriver;
  /** Sessions whose tmux session exists before their store row does. Never orphans. */
  private readonly starting = new Set<string>();

  constructor(store: Store, tmux: TmuxDriver) {
    this.store = store;
    this.tmux = tmux;
  }

  /**
   * Runs `start`, which brings the tmux session for `id` to life, without letting a
   * concurrent `reconcile()` mistake it for an orphan. The store row for `id` must exist by
   * the time `start` resolves.
   */
  async whileStarting<T>(id: string, start: () => Promise<T>): Promise<T> {
    this.starting.add(id);
    try {
      return await start();
    } finally {
      this.starting.delete(id);
    }
  }

  /**
   * Kills orphans, stores the conversation each live Claude Session is on, and returns the
   * Sessions that are alive, by id.
   */
  async reconcile(): Promise<Map<string, LiveSession>> {
    const live = new Map((await this.tmux.listSessions()).map((s) => [s.id, s]));
    for (const [id, session] of [...live]) {
      if (CONVERSATION_ID.test(session.conversation)) {
        this.store.setConversationId(id, session.conversation);
      }
      // Order matters: a Session no longer starting already has its store row.
      if (this.starting.has(id) || this.store.getSession(id)) continue;
      live.delete(id);
      await this.tmux.killSession(id);
    }
    return live;
  }
}
