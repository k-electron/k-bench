# Claude Agent internals

How a [Claude Agent](../../GLOSSARY.md) works inside, and the interfaces each later ticket of the [Claude Agent spec](https://github.com/k-electron/k-bench/issues/128) builds on. The decisions are in [ADR-0007](../adr/0007-agent-runtime-lives-in-a-hidden-tmux-session.md) (where the runtime lives) and [ADR-0008](../adr/0008-the-agent-runtime-holds-the-conversation.md) (who holds the conversation). What the owner sees is in the [guide](../guide/claude-agent.md), and what is done is in the [parity checklist](../claude-agent-parity.md). This page is the map of the code.

```
browser (React)               server (Hono)                       hidden tmux session kb-<session id>
 agentConnection.ts  --WS-->  /api/sessions/:id/agent  --unix-->  Agent Runtime (node, one bundled file)
 agent/transcript.ts   JSON   AgentSockets: relay, unread  lines    |  log.jsonl, the turn, agent.sock
 components/agent/*                                                 `--> installed `claude` (stdio) via the Agent SDK
```

- tmux only keeps the runtime alive and records whether it runs: a tmux session `kb-<id>` exists exactly while the Agent runs, and the reconciler treats it like any other Session (ADR-0001, ADR-0002). **No terminal ever attaches**: `Service.hasRunningShell` is false for an Agent, so the terminal WebSocket closes with 4410.
- The runtime is the single holder of the conversation. The server relays its frames and never parses them.
- The browser turns SDK messages into what is shown (`web/src/agent/transcript.ts`), so a display fix lands on the next page load.

## The wire protocol: `src/shared/agent-protocol.ts`

One definition, imported by the runtime, the server, the browser and the test client; it has no imports and no Node APIs. The same JSON messages travel on the runtime's unix socket (one per line) and on the browser's WebSocket (one per text frame). `AGENT_PROTOCOL_VERSION` is `1`. The protocol **only grows by additions**: a new message `type`, or a new optional field. A receiver ignores a `type` it does not know (`decodeAgentServerMessage` returns `undefined`). A change that cannot be made that way bumps the number.

Runtime to client (`AgentServerMessage`):

| `type`    | Fields                                                                              | When                                                                                                                                        |
| :-------- | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `hello`   | `protocol`, `runtimeBuildId`, `claudeVersion`, `sdkVersion`, `sdkClaudeCodeVersion` | First on every connection. The runtime listens only once `claude` has answered the SDK's first request, so `claudeVersion` is always there. |
| `status`  | `state`: `"idle"` or `"working"`                                                    | On connect, and to every connection whenever it changes. Ticket #142 grows it (Waiting, version warning, mode, tasks...).                   |
| `replay`  | `entries: LogEntry[]`                                                               | The answer to `sync`.                                                                                                                       |
| `entry`   | `entry: LogEntry`                                                                   | Every entry appended after a connection's `sync`, to every synced connection.                                                               |
| `partial` | `message`: an SDK `stream_event`                                                    | Live text fragments, to every synced connection. Never logged, never replayed.                                                              |
| `error`   | `code` (`bad_message`, `already_synced`), `message`                                 | A refused message.                                                                                                                          |

Client to runtime (`AgentClientMessage`, checked by `decodeAgentClientMessage`, which the runtime applies to every line it receives):

| `type`     | Fields                                   | Meaning                                                                                                                                                                                                                                                                                                            |
| :--------- | :--------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`     | `afterSeq`                               | Replay every entry after `afterSeq`, then every entry and fragment from that moment on. The replay and the join happen in one turn of the event loop, so there is no gap and no repeat. Once per connection. A connection that never syncs (the server's status connection, later) gets only `hello` and `status`. |
| `prompt`   | `id` (a UUID the client chooses), `text` | Sent to Claude Code as typed, with `id` as the message's `uuid`, which Claude Code echoes back because user messages are replayed. Never marked as composed by the client, so `@path` expands.                                                                                                                     |
| `shutdown` |                                          | Ends the Agent (below).                                                                                                                                                                                                                                                                                            |

To **add a message**, add it to the unions here, to the matching `decode...` function, and handle it in `ClientHub` (`src/agent-runtime/hub.ts`, for what concerns the connection) or `command()` in `src/agent-runtime/main.ts` (for what concerns Claude Code). Nothing between the browser and the runtime needs to change: the relay forwards whole frames.

### Log entries (`LogEntry`)

Each is `{seq, t, kind, ...}`; `seq` counts from 1 with no gaps and carries on across runtime restarts. Kinds: `sdk` (`message`: an SDK message **unchanged**, except `stream_event`s), `prompt` (`id`, `text`: written before the prompt is sent, because no echo exists until Claude Code takes it up), `runtime` (`event`: `started` or `stopped`, with a `reason`), and `permission_asked` / `permission_answered` (types only so far: written from #135). A reader ignores a kind it does not know. History never comes from the SDK's `getSessionMessages`, except for the one-time import of Open in web (#156).

## The Agent folder: `src/agent/`

Node code shared by the server (which compiles it, `tsconfig.build.json`) and the runtime (which bundles it). It must never import from `src/server` or `src/agent-runtime`.

- `paths.ts`: every location, so the two sides cannot disagree. `<dataDir>/agents/<session id>/` holds `log.jsonl`, `agent.sock` and `exit.json` (later `images/`, #159). `<dataDir>/runtimes/<build id>/agent-runtime.mjs` is an installed runtime. `agentsRoot`, `agentFolder`, `agentLogFile`, `agentSocketFile`, `agentExitFile`, `runtimeFile`, `runtimeBuildId(bytes)` (SHA-256 hex), `makeOwnerOnlyFolder` and `ensureOwnerOnlyFolder`.
- **Permissions.** The parent and each Agent folder are mode `0700`, set with `chmod` after `mkdir` because the umask cuts `mkdir`'s own mode. There is no token: whoever can open the folder can reach the socket. Node binds a unix socket path longer than macOS's 104 bytes (checked to 250 characters, so no short-path trick is needed; do not try it with `nc -U`); a data folder so deep that the path passes about 255 makes the Agent fail to start, with the reason. **Only the server creates these folders.** The runtime and the launcher never `mkdir`, so a runtime still exiting cannot bring back a folder the server just deleted.
- `log.ts`: `AgentLog(file)` with `append(entry)` (numbers and stamps it, `appendFileSync`), `readAfter(seq)`, `last` and `hasPrompt()`. A write cut short by a crash is skipped on read. The runtime appends and the server reads it directly while an Agent is Stopped (#144), so both show the same history. Ticket #141 adds `tailTurns` and `readPage`.
- `exit.ts`: `exit.json` (`{reason?, code?, signal?, at}`). tmux ends a Session's pane, and so the Session, the moment its command exits, so this file is the only place a reason survives. The runtime writes it with a reason in plain words on every exit it controls (Claude Code died, shut down, a signal, a crash); the launcher fills the gap when the runtime was killed (`code`, `signal`, no `reason`). Readers: `readExitRecord(folder)`. The launcher deletes it before each start.
- `lines.ts`: `LineSplitter`, the newline framing of the unix socket.

## The Agent Runtime: `src/agent-runtime/`

One long-lived Node process per Agent, started with `--agent-dir --folder --claude --conversation --mode` (`args.ts`; arguments only, never environment, because the tmux server's environment is whatever its first command had). `main.ts` wires:

- `session.ts`, `ClaudeSession`: the Agent SDK's `query()` pointed at the owner's installed `claude` (`pathToClaudeCodeExecutable`, absolute) with everything the spec fixes: the `claude_code` system prompt preset, the default settings sources (`settingSources` left unset, so CLAUDE.md, skills, plugins, hooks, MCP servers and permission rules load as in the terminal), `includePartialMessages`, **`enableFileCheckpointing: true` from the first launch** (it cannot be added later, and `/rewind` in the terminal depends on it), `extraArgs: {"replay-user-messages": null}`, and a `canUseTool` that waits for as long as the runtime lives (there is no `defer`; #135 answers it). `mode: "start"` is `sessionId` (`--session-id=`); `mode: "resume"` is `resume` (`--resume=`), except that when the log holds no prompt it starts instead, because Claude Code saves a conversation only after its first message.
- `hub.ts`, `ClientHub`: the unix socket (mode `0600` inside a `0700` folder), a hello for each connection, validation, `sync`, and the fan-out of entries and fragments. It knows nothing of Claude Code.
- `main.ts`: logs every SDK message (`record()`: append, then send to every synced connection, so order is preserved), counts turns in flight for `status`, and ends:
  - **Shutdown** (the `shutdown` command, or SIGTERM, SIGHUP, SIGINT): records a `runtime stopped` entry and `exit.json`, closes Claude Code (`query.close()` kills it) and the socket, exits 0. The server kills the tmux session if the runtime has not exited a few seconds after `shutdown` (`AgentRuntimes.shutdown`).
  - **Claude Code ended or the runtime failed**: the same, with the reason, and exit status 1. Nothing restarts it. Claude Code and the runtime live and die together.
- It listens only once `claude` has said which version it is (`initializationResult()`), so every hello carries `claudeVersion`.

### The build and the build ID

`vite.runtime.config.ts` builds `src/agent-runtime/main.ts` into **one self-contained file**, `dist/runtime/agent-runtime.mjs`, with the Agent SDK inside (`build.ssr`, `ssr.noExternal`, one chunk), about 1.4 MB, run by plain `node`. `pnpm build:runtime` builds it and `pnpm build` includes it. The SDK is a development dependency only (pinned exactly; Dependabot gives it its own pull request), so the published package depends on no SDK, and installing k-bench never fetches the SDK's optional platform package with its bundled Claude Code (about 338 MB). The SDK's own version (`sdkVersion`) and the Claude Code version it was made for (`sdkClaudeCodeVersion`) are baked in with Vite's `define`, because the SDK is not installed where the runtime runs. **The runtime build ID is the SHA-256 of the file**; the runtime computes it from its own bytes, since a file cannot hold its own hash.

Note for whoever reviews dependencies: the bundle contains the SDK's code, which has its own license ("SEE LICENSE IN README.md" in its package), not k-bench's MIT.

### Launching: `agentCommand` in `src/server/claude.ts`

`TmuxDriver.createAgentSession(id, folder, launch)` starts the runtime as the Session's only program. The command is the same three-hop chain as a Claude TUI (`loginChain`): zsh with no startup files changes into the folder, the owner's login shell (`-l -i`) gives the owner's environment, and `/bin/sh` runs the Agent launcher with positional arguments only (never spliced into script text). The launcher resolves `claude` with `command -v` inside the login shell (the SDK needs an absolute path; a name with a slash is used as given), then **runs Node as a child, not with `exec`**, so it outlives the runtime and writes the `exit.json` gap record for an exit the runtime did not record. It is POSIX `sh`, so it runs under macOS's bash-as-sh and CI.

## The server

- `src/server/agents.ts`, **`AgentRuntimes`**: everything the server does to an Agent. It keeps no state about a running Agent (tmux says what runs):
  - `install()`: copies the built runtime into `<dataDir>/runtimes/<build id>/` (once; content-addressed; through a temporary name), so a running runtime survives the app folder being replaced by an update (ADR-0007). It never throws: without a runtime only Claude Agents are unavailable (`current`, and `launch` says why). Keeping the folder until no running runtime uses it is #158.
  - `launch({sessionId, workspaceFolder, conversationId, mode})`: makes the Agent's folder (`0700`) and starts the runtime.
  - `connect(sessionId, stillWanted)`: the runtime's socket, retried until it listens; used by the relay, and the way #142 opens its status connection.
  - `waitUntilReady(sessionId)`: the runtime's hello, or an `AgentStartError` carrying the reason it recorded. Creating an Agent waits for it, so the API answers once the Agent is running, and a failed start leaves no Session, tmux session or folder.
  - `isRunning`, `shutdown(sessionId)` (send `shutdown`, wait for the tmux session to go, kill it after four seconds), `removeFolder`.
- `src/server/agent-sockets.ts`, **`AgentSockets`**: `GET /api/sessions/:id/agent`, behind the same access guard and Origin check as the terminal (`server.on("upgrade")` in `server.ts`). For each browser socket it opens one connection to the runtime's socket and forwards whole frames both ways unread. It closes with **4410** only when the Session ended (not a running Agent when asked, or the runtime hung up and its tmux session went); a runtime that hung up while its Session is still running, or one that did not start, closes with 1011; a stopping server drops the socket with no 4410 so that the browser reconnects (#134).
- `service.ts`: `createSession(workspaceId, name, claude?: {options, interface})`; Claude Agent is `interface: "agent"`. Delete (of a Session or a Workspace) shuts the runtime down, removes the row, then removes the folder. Restart of a Stopped Agent starts the runtime with `mode: "resume"` (#144 extends it: Stop, the Stopped Transcript, confirms). `getState()` adds `interface` for Claude Sessions.
- `store.ts`: `sessions.interface` (`tui` or `agent`, null for a shell; existing Claude Sessions became `tui`). The New Session dialog's remembered kind can be `claude-agent`; creating an Agent leaves the remembered Launch options as they were.
- `config.ts` / `ServerOptions.agentRuntimeFile`: the built runtime to install. `main.ts` passes `dist/runtime/agent-runtime.mjs` relative to its working directory, as it does `dist/web`. It is an option, not an instance setting, so a test can start a server on a second runtime build (#158).

## The browser

- `web/src/agentConnection.ts`: `createAgentConnection({sessionId, openSocket})`, no React: opens the socket, sends `sync` from the newest entry it has had as soon as it opens, keeps messages sent while opening, reports each message and when the socket closed (`ended` for 4410). Reconnecting with backoff is #134; it is the same shape as `terminalConnection.ts`.
- `web/src/agent/transcript.ts`: the pure reducer, `applyServerMessage(state, message)` and `transcriptItems(state)`: entries plus live fragments in, display items (`prompt`, `assistant`) out. Partial text is shown until the complete message for its block arrives (Claude Code sends one complete `assistant` message per content block, in order), and replaced by it. Ticket #136 gives it Claude Code's real shape; every later kind of thing shown is a new `TranscriptItem` kind built here.
- `web/src/agent/useAgentConversation.ts`: the hook the Pane uses: `{items, hello, state, ended, send}`.
- `web/src/components/agent/`: `AgentPane` (the conversation, `role=log`), `Composer` (the input). On desktop Enter sends and Shift+Enter starts a new line; on a phone Return starts a new line and the Send button sends. A Claude Agent never gets Extra keys or Smart typing (`usePaneView.focusedHasTerminal`). `Pane.tsx` switches on `session.kind === "claude" && session.interface === "agent"`; `SessionRow` shows a speech bubble and keeps the Claude spark.
- Accessible names tests across tickets rely on (keep them stable): the Pane region `Claude Agent <name>`, the conversation `Conversation` (`role=log`), the input `Message Claude`, the button `Send`, the dialog kind `Claude Agent (WIP)`.

## Tests

See [Test seams](test-seams.md#claude-agents). In short: `instance.fakeClaude` scripts the fake `claude` the real runtime and SDK drive; `server.createClaudeAgent(workspaceId)` and `server.openAgent(sessionId)` (an `AgentClient`: `hello`, `entries`, `fragments`, `assistantTexts`, `sync()`, `prompt()`, `waitForEntry()`) are the Seam 1 handles; `AppPage.createClaudeAgent`, `agentRegion` and `agentInput` are Seam 2's.
