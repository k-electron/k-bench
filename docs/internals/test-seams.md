# Test seams

[Testing](../testing.md) says what a good test is here. This page describes the three harnesses tests go through: Seam 1, the server's HTTP and WebSocket API with Vitest; Seam 2, the browser with Playwright; and Seam 3, the packed `k-bench` command run as a process, also with Vitest. Run them with `pnpm test` (Seams 1 and 3) and `pnpm test:e2e` (Seam 2); Playwright needs its browsers installed once, as [CONTRIBUTING](../../CONTRIBUTING.md#prerequisites-and-setup) says.

## Seam 1: the server (Vitest)

Tests live in `test/`; the harness is in `test/harness/`.

- `createTestInstance()` gives an isolated instance (a temp data folder and its own `kb-test-*` tmux socket) that is cleaned up after each test. `bootWithWorkspace()` (`boot.ts`) starts one with a Workspace already made.
- `instance.start()` boots the real server in-process, and can be called again after `stop()` to simulate a restart. `{ statePollMs }` lengthens the state poll, so a test can tell a pushed change from a polled one.
- Every request and upgrade carries the instance's configured login in `Tailscale-User-Login` by default. `server.as(login)` and `server.anonymous()` send another login or none, `server.withHeaders({origin, host})` adds headers such as a page's `Origin`, and `server.upgradeStatus(path)` reports the status refusing an upgrade.
- `server.openEvents()` returns an `EventsClient` (collected snapshots, `waitForSnapshot()`).
- `instance.openStateClient({ showTimeoutMs })` builds the browser's state client over a `ws` WebSocket carrying the login header, since Node's built-in WebSocket can't send one. It follows the instance across `stop()` and `start()`, so a test can watch it reconnect to a restarted server. Wait for a change with `client.whenShown({ revision })`, where `revision` is `revisionOf(response.headers)` from `src/shared/state-protocol.ts`. It is closed with the instance.
- `instance.openTerminalConnection(sessionId, { size, retryFirstMs, retryMaxMs, wake })` builds the browser's terminal connection the same way, with a backoff of a few milliseconds by default. `wake` stands in for the page becoming visible or online: a test keeps the `retry` it is given and calls it. It returns a `TerminalConnectionProbe` (`run()`, `waitForOutput()`, `output`, `reconnecting`, `ended`, `socketsOpened`, and the connection itself as `.connection`).
- `server.openTerminal()` returns a `TerminalClient` with `run()`, `resize()` and `waitForOutput()`.
- `server.createClaudeSession(workspaceId, { name?, claude? })` creates a Claude Session (it sends `claude: {}` unless given Launch options).
- Sessions run the owner's real login shell, but each instance gives its shells a `ZDOTDIR` of their own whose `.zshrc` only unsets `HISTFILE`. So test shells read neither the owner's `~/.zshrc` nor their history, and keep none. Shared, zsh's history-file lock made shells starting while others exited wait up to 10 seconds, and test commands landed in the owner's history.
- `pollUntil()` waits for outcomes.
- `old-store.ts` writes a store as an older k-bench left it (`writeOldStore(instance, version, sql)`), for tests of the upgrade.
- `tmux.ts` reaches a test instance's tmux server directly: it kills it (a Host reboot), plants a tmux session the store does not know, lists the sessions and running clients, types into a Session with no terminal attached (how a test rings a Bell nobody watches) and counts the clients attached to a Session. It refuses any socket not named `kb-test-*`.
- `attachments.ts` boots the `Attachments` module over a running Session, with a `RecordingViewer` and a Session lookup the test can hold pending, for the terminal-lifecycle races the WebSocket can't time.

### The fake Claude Code

No test runs the real Claude Code. The stand-in is `test/harness/fake-claude.sh`, a plain `sh` script, since the CI runner's shell is bash 3.2. `createTestInstance()` copies it, with its own `conversations` folder beside it, into the instance's temp folder and points the instance's `claudeProgram` at it. The tmux server's environment is not the test's, so the stub is configured by where it lives, not by environment variables. Pass `createTestInstance({ claudeProgram })` to test a program that is missing.

The flags that reach the stub are the contract with Claude Code, so asserting on them checks a boundary. The stub:

- On start prints `claude-stub cwd: <folder>`, `claude-stub advisor tool disabled: <value or unset>` and one `claude-stub arg: <argument>` line per argument, then `claude-stub ready`. `fakeClaudeArgs(terminal)` waits for it and returns the arguments of the attempt that started; a restart that finds nothing to resume shows the failed `--resume` attempt too.
- Prints `--settings` without its hooks as one `claude-stub settings: <JSON>` line (`fakeClaudeSettings(terminal)`), instead of as arguments. It runs their hook commands as Claude Code does, with the event's JSON on stdin, and runs a tool event's hooks only when their group's `matcher` matches the tool's name, by Claude Code's rules (exact names, or else a regular expression). `SessionStart` runs at start (source `startup`, or `resume` for `--resume`) and on `clear`. Then it prints `claude-stub conversation: <id>` (`fakeClaudeConversation(terminal)`), so a test that sees it knows the hooks have run. `ignoreClaudeSettings(program)` makes it ignore `--settings`, as Claude Code does when hooks can't run.
- Prints what a `SessionStart` or `UserPromptSubmit` hook prints as `claude-stub context: <output>`, since Claude Code adds that to the conversation. A test asserts the line never shows.
- Treats any line but the commands below as a message, one whole turn: it runs the `UserPromptSubmit` hooks, saves the conversation (as Claude Code does only once a message is sent), answers `claude-stub heard: <message>`, then runs the `Stop` hooks. Saved conversations are files in `conversations/` beside it (`fakeClaudeSavedConversations(program)`). `--resume` of an ID it never saved, and `--session-id` of one it saved, each fail with exit 1.
- Takes these commands:
  - `exit N` quits with status N.
  - `bell` rings the terminal bell.
  - `clear` switches to a new conversation ID, as `/clear` does.
  - `think` starts a turn, running a Bash tool, and holds it until the next message, so a test can see the Session Working.
  - `ask-permission` (`PermissionRequest`) and `ask-question` (`PreToolUse` for `AskUserQuestion`) make it Waiting, and `answer` (`PostToolUse` for that tool) answers.
  - `subagent-stop` runs a subagent's tool events, carrying its `agent_id`, then `SubagentStop`, and `subagent-ask-permission` a subagent's `PermissionRequest`.
  - `print N` prints a `claude-stub printing` line every quarter second for N seconds, then `claude-stub printed`, and runs no hooks: a tool's output, or one of Claude Code's stray redraws. Pass `createTestInstance({ workingQuietMs })` to shorten the quiet time a Working Session decays after.

  Each command runs its hooks before it prints its line, so a test that sees the line knows they have run. To put a Session into Waiting, type the command with `typeIntoSession` rather than through a terminal: a terminal's keys are the owner's, which end Waiting.

In Seam 2, `kbench.tellClaude(sessionName, line)` types a line into a Claude Session's stub with no browser involved, as `kbench.ringBell()` rings a Bell.

The stub's hooks run inside its test pane, so `tmux` there reaches the test's tmux server through `$TMUX`. Never run k-bench's hooks, or a real `claude` with k-bench's `--settings`, outside a test pane: inside one of your own k-bench Sessions they would record a conversation and a state on that Session.

## Seam 2: the browser (Playwright)

Specs live in `e2e/`.

- `e2e/harness.ts` exports `test` and `expect`. Its `kbench` fixture boots an isolated server in-process (a `createTestInstance()` on a random free port, so `kbench.stopServer()` and `kbench.startServer()` can restart it at the same address) serving `dist/web`, and sets the `Tailscale-User-Login` header on the browser context.
- The `app` fixture is an `AppPage` already open on the app, and `otherDevice` a second one in another browser context, standing for another Device. `AppPage`'s helpers find things by role and accessible name: `createWorkspace()`, `createSession()`, `createClaudeSession()` (which takes the Launch options by the label of the choice, such as `{ model: "Opus", effort: "XHigh", focusView: true }`), `session()`, `terminal()`, `runMarker()` and the rest.
- Claude Code is the same stub as in Seam 1, so a Claude Session's terminal shows the stub's lines.
- Playwright has three projects: `desktop` (1280x800, every spec except `phone.spec.ts` and `smart-typing.spec.ts`), `phone` (a Pixel 7: touch, 412px wide, only `phone.spec.ts`) and `iphone` (WebKit with Playwright's iPhone 15 settings, only `smart-typing.spec.ts`). In the Phone layout the sidebar is hidden until the drawer is open: use `openDrawer()`, `drawer` and `extraKey(name)`.
- Smart typing is offered only on an iPhone in the Phone layout, hence the `iphone` project. Playwright can't drive the real iOS keyboard, so a test makes the keyboard's edits itself on the terminal's hidden field (`keyboardEdit()` in the spec selects a range and runs `document.execCommand("insertText")` or `"delete"` over it, which raise real `beforeinput` and `input` events). It asserts what the Session's program received by running `cat -vet` on a terminal in raw mode (`stty raw -echo opost onlcr`), which prints Enter as `^M`, Backspace as `^?` and a line feed as `$`. Keep what a test sends short: a long line wraps in the narrow terminal and splits the text the test looks for. The hidden field is the textbox named "Terminal input", and its keyboard settings (`autocorrect`, `autocapitalize`, `spellcheck`) are what iOS reads, so tests assert on them as attributes. A cleared field holds the filler (U+200B), so assert with a pattern built from the spec's `ZWSP` constant, and `keyboardEdit()` counts its range after the filler.
- To add a test, write `e2e/<topic>.spec.ts`, import `test` and `expect` from `./harness.ts`, and add any new UI helper to `AppPage`. Use `kbench.instance.makeFolder()` for Workspace folders.

## Seam 3: the packed `k-bench` command (Vitest)

`test/packed-command.test.ts` tests what a stranger gets from `npm i -g @k-electron/k-bench`: the real package, run as a process. Its harness is `test/harness/packed.ts`.

- `packedPackage()` runs `pnpm build` (with `NODE_ENV=production`, since Vitest sets `test`), `npm pack`, and installs the tarball into a temp prefix, never the real one. It runs once per test process, fetches the package's dependencies from the npm registry (so it needs the network) and returns the installed package folder, its `k-bench` bin and its version. Call it in a `beforeAll` with a long timeout. Tests that use it should share one file, because each test file packs again.
- `new Stubs(options)` makes a folder of stub programs, written as plain `sh`. `runKBench(pkg, args, { stubs })` runs the packed command with `PATH` set to that folder plus `/usr/bin:/bin`, and `HOME` set to a fresh empty folder (returned as `result.home`), so the command can reach neither the real machine nor a real tmux or Tailscale.
  - `tmux: false`, `tailscale: false` or `launchctl: false` leave that program off PATH. A Mac with the Tailscale app still has its CLI inside `/Applications/Tailscale.app`, which the commands also find. `nodeVersion` stands in for an older Node.
  - `tailscale` answers `status --json` and `serve status --json` from files: set them with `new Stubs({ tailscale: { status, serveStatus } })`, or later with `stubs.setStatus()` and `stubs.setServeStatus()`. The defaults are a logged-in node and an empty serve configuration. Any other `tailscale` invocation is a change to the tailnet and is recorded in `stubs.tailscaleWrites()`, which is how a test checks that a dry run, or a refusal, changed nothing.
  - `serveStatusOf([443, "http://127.0.0.1:3000"], ...)` builds a serve configuration in the shape Tailscale prints. The stub doesn't apply writes to it, so a test sets up the configuration it needs.
  - `launchctl: { loaded: true }` makes `launchctl print` succeed. `stubs.launchctlCalls()` and `stubs.tmuxCalls()` record every call; the stub `tmux` always succeeds.
- `startPackedServer(pkg, login)` (`packed-server.ts`) starts the packed package's real server on a free port with a throwaway data folder and tmux socket, admitting only `login`. The `k-bench status` tests point the command at it with `K_BENCH_STATUS_PORT`, and give it a `HOME` holding a fake `Library/Application Support/k-bench/app/build-info.json`. Stop the server in an `afterEach`.
- To add a case, add a test to `test/packed-command.test.ts`, build the `Stubs` it needs, and assert on the exit status, the output, the files left in `result.home` and the recorded calls. If a command needs a new stub behaviour, add an option to `Stubs` rather than writing a one-off script in the test.

Seam 3 reaches everything the `k-bench` commands decide and print, against stubs; it can't reach real launchd, a real `tailscale serve` or a real tmux server ending, which stay on the [manual checklist](install-verification.md).

## The release tooling

`test/release.test.ts` runs `scripts/release.ts` as a process against throwaway repositories (a bare "origin" on disk, so no network, and a stub `gh` first on PATH that records its arguments), and `scripts/release-plan.ts` against a stub npm registry on localhost. See [Releasing](releasing.md).
