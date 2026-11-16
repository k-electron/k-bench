# An Agent Runtime lives in a hidden tmux session, and no terminal ever attaches to it

A Claude Agent must keep running through a k-bench restart, so its Agent Runtime can't be a child of the server. Each Agent Runtime runs in a tmux session on k-bench's existing socket, named by its Session's ID, and is started through the same login-shell chain as a Claude TUI so it gets the owner's environment. tmux is used only to keep the process alive and to record whether it is running, so ADR-0001 and ADR-0002 hold for Claude Agent too: a tmux session means running, none means Stopped. The owner never sees that tmux session. The conversation reaches the browser as structured messages over the Agent Runtime's own connection, and k-bench refuses to attach a terminal to a Claude Agent.

This amends ADR-0005 for Claude Agent only. k-bench consumes Claude Code's published Agent SDK messages. It still never scrapes a screen or reads Claude Code's private files, and a Claude TUI stays exactly as ADR-0005 describes.

## Considered Options

- **One launchd job per Agent Runtime.** Just as durable in the spike, and it reports exit status, but k-bench would have to create and clean up a job per Session and gain a second way of working out what is running.
- **A detached process.** Survives restarts, but when the Agent Runtime crashed its `claude` was left running under pid 1, which risks two processes on one conversation, and the only liveness check is a pid.

## Consequences

- An Agent Runtime and its `claude` live and die together. If either crashes, the Session is Stopped, is not restarted automatically, and shows why it stopped, because a Claude Agent has no screen to hold an error on. An Agent Runtime that doesn't answer its connection means the browser is reconnecting; it is not a new Session state.
- The installer deletes the old app folder, so an Agent Runtime can't run from it. Each k-bench version installs its runtime code in its own versioned folder under the data directory, kept until no running Agent Runtime uses it. That is what lets a running Agent Runtime keep its version through a k-bench update.
- Because the tmux session name is the Session's ID and the row exists, the existing reconcile treats an Agent Runtime like any other Session, and a Dev instance stays separate through its own socket.
