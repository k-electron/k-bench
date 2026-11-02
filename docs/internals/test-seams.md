# Test seams

[docs/testing.md](../testing.md) says what a good test is here and how to write one. This page describes the three harnesses tests go through: Seam 1, the server's HTTP/WebSocket API with Vitest; Seam 2, the browser with Playwright; and Seam 3, the packed `k-bench` command run as a process, also with Vitest. Run them with `pnpm test` (Seams 1 and 3) and `pnpm test:e2e` (Seam 2); Playwright needs its browser once (`pnpm exec playwright install chromium`).

## Seam 1: the server (Vitest)

Tests live in `test/`; the harness is in `test/harness/`.

- `createTestInstance()` gives an isolated instance (temp data folder, unique `kb-test-*` tmux socket) that is cleaned up after each test.
- `instance.start()` boots the real server in-process and can be called again after `stop()` to simulate a restart (`{ statePollMs }` lengthens the state poll, so a test can tell a pushed change from a polled one).
- Every request and upgrade carries the instance's configured login in `Tailscale-User-Login` by default. `server.as(login)` and `server.anonymous()` give views that send another login or none, `server.withHeaders({origin, host})` adds headers such as a page's `Origin`, and `server.upgradeStatus(path)` reports the status refusing an upgrade.
- `server.openEvents()` returns an `EventsClient` (collected snapshots, `waitForSnapshot()`).
- `server.openTerminal()` returns a `TerminalClient` with `run()`, `resize()` and `waitForOutput()`.
- `pollUntil()` waits for outcomes.
- `test/harness/tmux.ts` kills a test instance's tmux server (a Host reboot), plants a tmux session the store does not know, lists the socket's sessions, counts its running tmux client processes, types into a Session with no terminal attached (`typeIntoSession`, how tests ring a Bell nobody watches) and counts the clients attached to a Session (`attachedClientCount`). It refuses any socket not named `kb-test-*`.
- `test/harness/attachments.ts` boots an `Attachments` module over a running Session on a test socket, with a `RecordingViewer` and a Session lookup the test can hold pending, for the terminal-lifecycle races the WebSocket cannot time.

## Seam 2: the browser (Playwright)

Specs live in `e2e/`.

- `e2e/harness.ts` exports `test` and `expect`. Its `kbench` fixture boots an isolated server in-process (temp data folder, unique `kb-test-*` tmux socket, random free port, so `kbench.stopServer()` and `kbench.startServer()` can restart it at the same address) serving `dist/web`, and sets the `Tailscale-User-Login` header on the browser context.
- The `app` fixture is an `AppPage` already open on the app (`otherDevice` is a second one in another browser context), with helpers that find things by role and accessible name: `createWorkspace()`, `createSession()`, `session()`, `sessionStatus()`, `sessionMenu()`, `terminal()`, `runMarker()`, `runCommand()`, `terminalSize()`.
- Playwright has two projects: `desktop` (1280x800, every spec except `phone.spec.ts`) and `phone` (a Pixel 7: touch, 412px wide, runs only `e2e/phone.spec.ts`). `AppPage` has `openDrawer()`, `drawer` and `extraKey(name)` for the phone project, whose sidebar is hidden until the drawer is open.
- To add a test, write `e2e/<topic>.spec.ts`, import `test`/`expect` from `./harness.ts`, and add any new UI helper to `AppPage`. Use `kbench.instance.makeFolder()` for Workspace folders.

## Seam 3: the packed `k-bench` command (Vitest)

`test/packed-command.test.ts` tests what a stranger gets from `npm i -g @k-electron/k-bench`: the real package, run as a process. Its harness is `test/harness/packed.ts`.

- `packedPackage()` runs `pnpm build` (with `NODE_ENV=production`, since Vitest sets `test`), `npm pack`, and installs the tarball into a temp prefix with `npm install --global --prefix <tmp>`. Never the real prefix. It runs once per test process, fetches the package's dependencies from the npm registry (so it needs the network, and the npm cache makes repeats fast) and returns the installed package folder, its `k-bench` bin and its version. Call it in a `beforeAll` with a long timeout; tests that use it should share one file, because each test file packs again.
- `new Stubs(options)` makes a folder of stub programs, written as plain `sh` so they run under the bash 3.2 of the CI runner. `runKBench(pkg, args, { stubs })` runs the packed command with `PATH` set to that folder plus `/usr/bin:/bin` and nothing else, and `HOME` set to a fresh empty folder (it returns it as `result.home`), so the command can reach neither the real machine nor a real tmux or Tailscale.
  - `tmux: false`, `tailscale: false` or `launchctl: false` leave that program off PATH (a Mac with the Tailscale app still has its CLI at the fallback path inside `/Applications/Tailscale.app`, which the installer also finds). The folder also holds a `node` link, so the bin's `#!/usr/bin/env node` still works.
  - `tailscale` answers `status --json` and `serve status --json` from files. Set them per test with `new Stubs({ tailscale: { status, serveStatus } })`, or change them later with `stubs.setStatus(...)` and `stubs.setServeStatus(...)`; pass an object (stringified) or a string. The defaults are a logged-in node and an empty serve config. Any other `tailscale` invocation is a change to the tailnet and is recorded: `stubs.tailscaleWrites()` lists them, which is how a test checks that a dry run, or a refusal, changed nothing.
  - `serveStatusOf([443, "http://127.0.0.1:3000"], ...)` builds a serve configuration in the shape Tailscale prints (one web entry per `[port, proxy]`, under the host `STUB_DNS_NAME`). The stub does not apply writes to it: nothing in this seam runs a real install, which is the only thing that writes, so a test sets the configuration it needs up front.
  - `launchctl: { loaded: true }` makes `launchctl print` succeed; every call is recorded in `stubs.launchctlCalls()`. The stub `tmux` records every call in `stubs.tmuxCalls()` and always succeeds.
- `startPackedServer(pkg, login)` (`test/harness/packed-server.ts`) starts the packed package's real server on a free port with a throwaway data folder and tmux socket, admitting only `login`, and returns `{ port, stop() }`. It is how `k-bench status` gets a real health endpoint to ask: the status tests run the command with `K_BENCH_STATUS_PORT` set to that port (the stub serve configuration proxies to it too) and a `HOME` holding a fake `Library/Application Support/k-bench/app/build-info.json`. Stop the server in an `afterEach`.
- To add a case, add a test to `test/packed-command.test.ts`, build the `Stubs` it needs and assert on the exit status, stdout, stderr, the files left in `result.home` and the recorded calls. If a command needs a new stub behaviour, add an option to `Stubs` rather than writing a one-off script in the test.
- Covered: the packed package runs at all (`--version`, so compiled JavaScript with nothing missing), its server starts from the installed package and serves the built front end with the version in the startup line, `install --dry-run` describes the install, ends with the URL and changes nothing, a missing tmux or a Node older than 26 (`new Stubs({ nodeVersion })`) fails clearly, and an HTTPS port already serving something else stops the install (naming `--https-port` and `--force`) unless `--force`, another `--https-port` or k-bench's own entry (on any of two ports k-bench is published on) says otherwise. `uninstall --dry-run` and `--purge --dry-run` describe what they remove and keep, and work when nothing is installed; a real `uninstall` and `uninstall --purge` against stubs and a temp HOME remove the service, only k-bench's own serve entry and the app folder, keep the data, and (purge) end the tmux server and delete the data; with k-bench published on two ports, uninstall removes both entries and leaves a foreign one. The real install and uninstall, which load a LaunchAgent and change the tailnet, are not run: see the [manual checklist](install-verification.md).

## The release tooling

`test/release.test.ts` runs `scripts/release.ts` as a process against throwaway repositories (a bare "origin" on disk, so no network, and a stub `gh` first on PATH that records its arguments), and `scripts/release-plan.ts`, the release workflow's decision step, against a stub npm registry on localhost. The workflow file itself is proved by its manual dry run: see [Releasing](releasing.md).

## The installer and a built server

The install changes the real system, so only its pure parts are unit-tested (`test/install.test.ts`), plus the packed command's dry run (Seam 3); the rest is the [manual checklist](install-verification.md). To try a production build by hand without installing it, run `pnpm smoke` (add `--hold` to keep it up for manual requests); everything it starts is cleaned up when it exits. See [Packaging](packaging.md) for how the package is built.
