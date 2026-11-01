import type { Store } from "./store.ts";
import type { LiveSession, TmuxDriver } from "./tmux.ts";

/**
 * Compares the store with what is alive in tmux (ADR-0002). A Session in the store with no
 * live tmux session is Stopped, which callers learn from the returned live ids. A live tmux
 * session on this instance's socket with no store row is an orphan and is killed.
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

  /** Kills orphans and returns the Sessions that are alive, by id. */
  async reconcile(): Promise<Map<string, LiveSession>> {
    const live = new Map((await this.tmux.listSessions()).map((s) => [s.id, s]));
    for (const id of [...live.keys()]) {
      // Order matters: a Session no longer starting already has its store row.
      if (this.starting.has(id) || this.store.getSession(id)) continue;
      live.delete(id);
      await this.tmux.killSession(id);
    }
    return live;
  }
}
