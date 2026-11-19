# The Bell

A Session raises a Bell when its program rings the terminal bell, whether or not any browser is attached. A Claude Agent has no terminal, so it raises one by its own rules, [below](#a-claude-agents-bell). It shows as a pulsing Session row, and as a pulsing Workspace row while the Workspace is collapsed (the chevron by a Workspace name collapses it). Viewing the Session clears it, and viewing means a terminal attached to it: opening the Session in a Pane, or a Pane's terminal reconnecting. The front end has no Bell logic of its own beyond drawing the pulse.

## Mechanism (terminals)

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

## A Claude Agent's Bell

Ticket #145. The Bell of a Claude Agent does not live in tmux: no terminal rings it and none ever attaches (ADR-0007), so `@kb-bell` and `session_attached` have nothing to say. The **Agent Runtime** holds it (`src/agent-runtime/bell.ts`, `AgentBell`), for the reason it holds the conversation: it is the one process that sees every device's connection ([ADR-0008](../adr/0008-the-agent-runtime-holds-the-conversation.md)), and it outlives the server, so the Bell survives a k-bench restart as the terminal's does.

- **Raised** when a turn ends and when an ask opens (the runtime becoming Waiting for you), but only while no connection is viewing. A turn ends with the `result` of any turn: done, failed, interrupted, and a turn nobody sent (`/loop`).
- **Viewing** is a connection's `view {visible}` message ([wire protocol](agent.md#the-wire-protocol-srcsharedagent-protocolts)). The browser sends it when its agent socket opens (every reconnect too) and whenever `document.visibilityState` changes, with `visible` true only while the Pane shows the Agent **and** the page is visible. A background tab, a phone with its screen off, a socket that has not said anything (the server's status connection) and a connection that closed are all not viewing. This is stricter than the terminal's `session_attached`: it is not fooled by a stale tab, and walking away from the desk leaves the pulse for the phone.
- **Cleared** by any `view {visible: true}`, which clears it for every device at once: the Bell is a field of the runtime's `status` (`bell`), pushed to every connection, and the server reads it into `SessionState.bell` (`AgentStatuses.bellOf`, `Service.getState`). The front end still has no Bell logic: the row pulses on `session.bell`, in blue, and orange stays Waiting for you (`row-waiting` wins on a row that has both, its text is "is waiting for you" where the Bell's is "needs you").
- The runtime raises the Bell **before** it publishes the Idle or Waiting status it goes with, so no status shows Idle (or Waiting) after a turn ended unseen without the Bell. A test that sees Idle and no pulse has proof that none was raised.
- It is lost when the runtime ends, which is when the Agent is Stopped.

## The events socket's poll

The events socket's 400ms poll runs `getState()` (one `tmux list-sessions`, a `stat` per Workspace, the orphan check) only while some browser is subscribed. That is a deliberate cost of noticing programs that exit, which nothing announces; it is cheap at this scale and has not been tuned.
