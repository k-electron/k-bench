/**
 * A Claude Agent's Bell (ticket #145): "something happened here that you have not seen".
 * Raised when a turn ends (however it ends, and whoever started it) or an ask opens, but only
 * while no device shows the Agent on a visible page; cleared when any device shows it. It is
 * held here, not in tmux (`docs/internals/bell.md`): the runtime is the one place that knows
 * which connections are viewing, and it outlives the server.
 */
export class AgentBell {
  private raised = false;
  private readonly viewers: () => number;
  private readonly changed: () => void;

  constructor(options: {
    /** How many connections have a page showing the Agent now. */
    viewers: () => number;
    /** Called after the Bell was raised or cleared. */
    changed: () => void;
  }) {
    this.viewers = options.viewers;
    this.changed = options.changed;
  }

  /** Whether the Bell is raised. */
  get isRaised(): boolean {
    return this.raised;
  }

  /** A turn ended, or an ask opened: raises the Bell unless a device is looking. */
  attention(): void {
    if (this.raised || this.viewers() > 0) return;
    this.raised = true;
    this.changed();
  }

  /** A device shows the Agent: clears the Bell, for every device. */
  viewed(): void {
    if (!this.raised) return;
    this.raised = false;
    this.changed();
  }
}
