# Test seams

[docs/testing.md](../testing.md) says what a good test is here and how to write one. This page describes the two harnesses tests go through: Seam 1, the server's HTTP/WebSocket API with Vitest, and Seam 2, the browser with Playwright. Run them with `pnpm test` and `pnpm test:e2e`; Playwright needs its browser once (`pnpm exec playwright install chromium`).

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

## The installer and a built server

The install changes the real system, so only its pure parts are unit-tested (`test/install.test.ts`); the rest is the [manual checklist](install-verification.md). To try a production build by hand without installing it, run `pnpm smoke` (add `--hold` to keep it up for manual requests); everything it starts is cleaned up when it exits.
