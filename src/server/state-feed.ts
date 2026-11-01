/** Receives each state snapshot, serialised as JSON. */
export type SnapshotListener = (snapshot: string) => void;

/**
 * Change detection for the events WebSocket. It reads the state, and whenever the result
 * differs from the last one sent, pushes the fresh snapshot to every subscriber.
 *
 * Two things trigger a read: `notify()`, which the HTTP layer calls after a mutation and the
 * Bell watch calls when a Bell changes, and a short-interval poll, which notices what nothing
 * announces (a shell exiting). The poll only runs while someone is subscribed.
 */
export class StateFeed {
  private readonly read: () => Promise<unknown>;
  private readonly intervalMs: number;
  private readonly listeners = new Set<SnapshotListener>();
  /** Subscribers that have not been sent anything yet: they get the snapshot unchanged or not. */
  private readonly fresh = new Set<SnapshotListener>();
  private last: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reading: Promise<void> | undefined;
  private dirty = false;

  constructor(read: () => Promise<unknown>, options: { intervalMs?: number } = {}) {
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

  /** Something may have changed: re-read now rather than at the next poll. */
  notify(): void {
    if (this.listeners.size > 0) void this.refresh();
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
    let snapshot: string;
    try {
      snapshot = JSON.stringify(await this.read());
    } catch (error) {
      console.error("state feed could not read the state", error);
      return;
    }
    const changed = snapshot !== this.last;
    this.last = snapshot;
    const targets = changed ? [...this.listeners] : [...this.fresh];
    this.fresh.clear();
    for (const listener of targets) listener(snapshot);
  }
}
