import { encodeSnapshot, type State } from "../shared/state-protocol.ts";

/**
 * Receives each state snapshot, serialised as JSON: the state's own fields plus `revision`
 * (see `StateFeed` and `src/shared/state-protocol.ts`).
 */
export type SnapshotListener = (snapshot: string) => void;

/**
 * Change detection for the events WebSocket. It reads the state, and whenever the result
 * differs from the last one sent, pushes the fresh snapshot to every subscriber.
 *
 * Two things trigger a read: `notify()`, which the HTTP layer calls after a mutation and the
 * Bell watch calls when a Bell changes, and a short-interval poll, which notices what nothing
 * announces (a shell exiting). The poll only runs while someone is subscribed.
 *
 * Every snapshot carries a `revision`: the number of `notify()` calls made before its read
 * began. So a snapshot at revision `n` or later shows every change announced by the `n`th
 * `notify()`, which returns `n`. A client that made a change waits for that revision, rather
 * than for the change itself. A notify that turns out to change nothing still gets a
 * snapshot carrying its revision, so nobody waits for one that never comes. Revisions start
 * again from 0 when the server restarts.
 */
export class StateFeed {
  private readonly read: () => Promise<State>;
  private readonly intervalMs: number;
  private readonly listeners = new Set<SnapshotListener>();
  /** Subscribers that have not been sent anything yet: they get the snapshot unchanged or not. */
  private readonly fresh = new Set<SnapshotListener>();
  private last: string | undefined;
  /** How many times `notify()` has been called. */
  private revision = 0;
  /** The revision of the last snapshot sent to every subscriber. */
  private sentRevision = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reading: Promise<void> | undefined;
  private dirty = false;

  constructor(read: () => Promise<State>, options: { intervalMs?: number } = {}) {
    this.read = read;
    this.intervalMs = options.intervalMs ?? 400;
  }

  /** Subscribes to snapshots, starting with the current one. Returns the unsubscribe function. */
  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    this.fresh.add(listener);
    if (!this.timer) {
      this.timer = setInterval(() => void this.refresh(), this.intervalMs);
      this.timer.unref();
    }
    void this.refresh();
    return () => {
      this.listeners.delete(listener);
      this.fresh.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /**
   * Something may have changed: re-read now rather than at the next poll. Returns the
   * revision from which snapshots show the change.
   */
  notify(): number {
    this.revision++;
    if (this.listeners.size > 0) void this.refresh();
    return this.revision;
  }

  /** Stops polling and drops every subscriber. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
    this.fresh.clear();
    this.last = undefined;
    this.dirty = false;
  }

  /** Stops, then waits for a read that is still running, so nothing reads afterwards. */
  async close(): Promise<void> {
    this.stop();
    await this.reading;
  }

  /** One read at a time; a request that arrives during a read triggers another straight after. */
  private refresh(): Promise<void> {
    if (this.reading) {
      this.dirty = true;
      return this.reading;
    }
    this.reading = (async () => {
      try {
        do {
          this.dirty = false;
          await this.readOnce();
        } while (this.dirty);
      } finally {
        this.reading = undefined;
      }
    })();
    return this.reading;
  }

  private async readOnce(): Promise<void> {
    // Taken before the read starts, so the state read is at least this fresh.
    const revision = this.revision;
    let state: State;
    try {
      state = await this.read();
    } catch (error) {
      console.error("state feed could not read the state", error);
      return;
    }
    const body = JSON.stringify(state);
    const changed = body !== this.last || revision !== this.sentRevision;
    this.last = body;
    this.sentRevision = revision;
    const snapshot = encodeSnapshot(state, revision);
    const targets = changed ? [...this.listeners] : [...this.fresh];
    this.fresh.clear();
    for (const listener of targets) listener(snapshot);
  }
}
