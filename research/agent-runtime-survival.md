# What keeps an Agent Runtime alive across a k-bench restart?

Throwaway spike for the ticket "Spike: what keeps an Agent Runtime alive across a k-bench restart?". The code is in `spike/agent-runtime-survival/`. Nothing here is product code, and this branch is never merged.

**Setup.** macOS (Darwin 27.2), node 26.13, `@anthropic-ai/claude-agent-sdk` 0.3.319 driving the installed `claude` 2.1.319 through `pathToClaudeCodeExecutable`, `model: "haiku"`, `allowedTools: ["Bash"]`, `settingSources: []`. The runtime (`runtime.mjs`) holds one streaming-input `query()`, appends every `SDKMessage` to a file, and serves a newline-JSON protocol on a unix socket (replay of everything so far, then live).

A stand-in parent (`parent.mjs`) plays the k-bench server. It runs as its own LaunchAgent with the same keys as `buildLaunchAgentPlist` (`RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, the bare launchd `PATH`), and on start it either adopts a runtime whose socket answers or launches one. Each run starts a turn that executes `sleep 75` in Bash, restarts the parent mid-turn, waits, then connects a fresh client and waits for the turn's `result`. Each run used its own labels, tmux socket and socket path; the real k-bench was never touched.

Candidates, each started through the same chain a Claude TUI pane uses (`zsh -f` `cd`, then the owner's login interactive shell, then `exec`):

- **tmux**: a pane on a private tmux socket.
- **launchd**: its own LaunchAgent job (`RunAtLoad`, `KeepAlive` off), bootstrapped by the parent.
- **detached**: `spawn(..., { detached: true }).unref()`, which does `setsid`.
- **plain** (control): a child spawned with no `setsid`.

## Restarting the parent mid-turn

Three restart modes, all with `AbandonProcessGroup` on:

- `bootout`, then delete and recreate the parent's app folder, then `bootstrap` (what the installer does on upgrade).
- `launchctl kickstart -k`.
- `kill -9` of the parent, so `KeepAlive` respawns it.

| Candidate | bootout + swap | kickstart -k | kill -9 parent |
| --------- | -------------- | ------------ | -------------- |
| tmux      | survived       | survived     | survived       |
| launchd   | survived       | survived     | survived       |
| detached  | survived       | survived     | survived       |

"Survived" means all of these held for every cell:

- The runtime kept its pid.
- Its `claude` child kept its pid.
- The turn finished with a `result` of `finished` in the runtime's own log.
- A new client reconnected on the unix socket, got the history replayed, and received the rest of the turn live.
- The respawned parent found the socket answering and adopted the runtime rather than starting another.

Without `AbandonProcessGroup` (bootout + swap only):

- tmux, launchd and detached still survived. tmux daemonizes and detached calls `setsid`, so both are out of the job's process group; the launchd job is a different job.
- The **plain** control died: launchd killed the runtime and its `claude`, and the new parent started a fresh runtime.
- The plain control survived with `AbandonProcessGroup` on.

So `AbandonProcessGroup` is not what protects tmux or a detached child on this macOS. It protects a child that is neither, and it's cheap to keep.

## When the runtime itself dies mid-turn

`kill -9` of the runtime, 8 s later:

| Candidate | `claude` child                                | Liveness after                                                         |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| tmux      | killed with the pane                          | `has-session` fails ("no server running"); the pane is gone            |
| launchd   | killed with the job                           | `launchctl print` shows `state = not running` and the last exit status |
| detached  | **orphaned to pid 1, still running its tool** | only a dead pid and a refused socket                                   |
| plain     | **orphaned to pid 1, still running its tool** | same as detached                                                       |

A detached runtime that crashes leaves a live `claude` still working on the conversation. Resuming that conversation while the orphan runs would put two processes on one conversation. Detached would need its own reaper, for example recording the `claude` pid and killing it before any resume. tmux and launchd tear the tree down for free.

## Liveness signals

- **The unix socket answers** works for all three. After a crash the socket _file_ remains, so "file exists" is not liveness; "connect succeeds" is.
- **tmux**: `tmux -L <socket> has-session` is the same shape as ADR-0002, but a tmux session with no row would be "cleaned up" by the existing reconcile unless Agent Runtimes use a separate socket or prefix.
- **launchd**: `launchctl print gui/<uid>/<label>` reports state, pid and last exit status, which says why a runtime stopped.
- **detached**: only a pid check (`kill -0`), with the usual pid-reuse risk. This is the weakest.

## Environment

All three candidates, started through the login-shell chain, had identical `PATH` (19 entries including `~/.local/bin`, the Homebrew prefix and the Docker bin), `SHELL`, `LANG`, `HOME` and `SSH_AUTH_SOCK`. The Bash tool inside the conversation saw that same `PATH` and resolved `node`, `pnpm` and `claude`. Only the terminal-ish variables differ: `TERM`/`TERM_PROGRAM`/`TMUX` exist only under tmux, and `XPC_SERVICE_NAME` names the launching job. The runtime process under tmux gets a real tty, which the other two don't, so `claude` ran fine without one.

`init` reported `apiKeySource: "none"`, and the turns ran on the Host's existing `claude` login in all three. That is evidence the login reaches a runtime started under launchd, tmux and `setsid`. It says nothing on whether using that login through the SDK is allowed (the separate ticket "Get a clear answer on using a subscription login through the Agent SDK").

## Side observation

Because the runtime sees every message live and writes its own log, a reconnecting browser (or the server) can be caught up from the runtime alone: replay, then live, over one connection, with no `getSessionMessages` stitching. SDK history is only needed when the runtime itself is restarted and resumes a conversation.

## Not tested

- Reboot or logout. Nothing here survives that, as the lifecycle decision expects; a launchd job bootstrapped from a plist outside `~/Library/LaunchAgents` is not reloaded at login either.
- Graceful termination (SIGTERM/SIGHUP handling), several runtimes at once, a pending `canUseTool` prompt across restarts.
- Default settings sources, so no plugins, hooks or MCP servers (their extra child processes) were involved.
- A launchd job whose command skips the login-shell chain, which would get the bare plist `PATH`.

13 haiku turns, about $0.03 in total.
