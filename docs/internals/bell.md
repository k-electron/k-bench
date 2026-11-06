# The Bell

A Session raises a Bell when its program rings the terminal bell, whether or not any browser is attached. It shows as a badge on the Session row, and as a hint on a collapsed Workspace (the chevron by a Workspace name collapses it). Viewing the Session clears it, and viewing means a terminal attached to it: opening the Session in a Pane, or a Pane's terminal reconnecting. The front end has no Bell logic of its own.

## Mechanism

**tmux hooks**, not a poll (ticket #11 asked for this to be recorded; #21 made them the Bell's one owner). The tmux driver sets two hooks on the instance's tmux server, and they are the only place that decides what viewing means:

- `alert-bell` stores the bell in the Session-scoped user option `@kb-bell`, only while no client is attached to the Session that rang (`if-shell -F "#{==:#{session_attached},0}" { set-option @kb-bell 1 ; ... }`).
- `client-attached` clears the option for the Session a client attached to.

Both also signal the tmux `wait-for` channel `kb-bell-changed`. The server keeps a `tmux wait-for kb-bell-changed` client waiting on it (`TmuxDriver.watchBells`) and re-reads the state the moment it returns, so every Bell change reaches the events socket at once. tmux keeps a signal sent while nobody waits for the next wait, so none is lost between two waits. `list-sessions` reads the option back with the rest of the live state, for `GET /api/state`. At startup the server re-applies the hooks to a tmux server that an older k-bench left running.

## Why

- tmux runs the hooks with no client attached, and in its own single thread, so no bell can slip between "is anyone attached?" and recording it, or between attaching and clearing.
- The Bell lives in tmux ([ADR 0002](../adr/0002-tmux-is-the-source-of-truth-for-liveness.md)) as an option on the Session, so it survives a k-bench restart and needs no store column. It is lost only when tmux itself dies, when the Session is Stopped anyway.
- tmux's own bell flag can't be cleared with no client attached (re-selecting the current window is a no-op), so polling it would have needed a window-switching workaround. The option clears with one command.

## Known limitations

- `session_attached` counts every attached client, on any device, not clients that are actually showing the Session. A stale browser tab (or a laptop left open) with the Session's terminal still connected suppresses the Bell while you are elsewhere. This is the deliberate trade-off above: a bell rung while someone is looking must not linger. Close the stale tab to get Bells again.
- A Pane whose terminal has ended while its Session still runs (its tmux client was detached from outside k-bench) is not viewing the Session, so a Bell rung then shows until the Pane is opened again.

## The events socket's poll

The events socket's 400ms poll runs `getState()` (one `tmux list-sessions`, a `stat` per Workspace, the orphan check) only while some browser is subscribed. That is a deliberate cost of noticing programs that exit, which nothing announces; it is cheap at this scale and has not been tuned.
