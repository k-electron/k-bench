# k-bench

A web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on your Mac, organised into Workspaces. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the design decisions.

## Requirements

- macOS, Node 26 or later, pnpm
- tmux (`brew install tmux`)
- Tailscale, to install it as a service (see below)

## Commands

```sh
pnpm install     # also restores the execute bit on node-pty's spawn-helper
pnpm dev         # Dev instance: server (watch mode) on port 7690 plus Vite on :5173, which proxies /api; data in ./.data, tmux socket "k-bench-dev"
pnpm dev:serve   # publish the Dev instance on the tailnet at https port 8443
pnpm build       # production front end into dist/web
pnpm start       # the server alone; serves dist/web when it exists
pnpm install-app # build and install the Installed instance (launchd + tailscale serve); --dry-run to preview
pnpm lint        # Biome
pnpm typecheck   # tsc, for the server/tests and for the front end (web/)
pnpm test        # Vitest (Seam 1, the server)
pnpm test:e2e    # Playwright (Seam 2, the browser); builds the front end first
```

The access guard refuses requests without the right `Tailscale-User-Login`, so run `pnpm dev` with `K_BENCH_ALLOWED_LOGIN=you@example.com`: Vite's proxy then adds that header to `/api` requests, standing in for `tailscale serve`.

Playwright needs its browser once: `pnpm exec playwright install chromium`.

`K_BENCH_INSTANCE` (`dev` by default, or `installed`) selects an instance preset. `K_BENCH_DATA_DIR`, `K_BENCH_TMUX_SOCKET`, `K_BENCH_PORT`, `K_BENCH_ALLOWED_LOGIN` and `K_BENCH_PICKER_ROOT` each override one value.

## Install, update and the Dev instance

### Prerequisites

- tmux: `brew install tmux`.
- Tailscale, signed in, with HTTPS certificates enabled for the tailnet (admin console, DNS page). The CLI is found on PATH or inside `/Applications/Tailscale.app`.
- Node 26 or later and pnpm, as above. Run `pnpm install` once in the checkout.

### Install

```sh
pnpm install-app --dry-run   # prints every step and changes nothing
pnpm install-app
```

This builds k-bench and installs it as the Installed instance:

- the server, built assets and production dependencies (including node-pty, with its `spawn-helper` execute bit checked) go to `~/Library/Application Support/k-bench/app/`; the database lives beside it in `~/Library/Application Support/k-bench/`;
- `~/Library/LaunchAgents/com.k-bench.server.plist` is written and (re)loaded: `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, the absolute Node path, a PATH that includes `/opt/homebrew/bin` (tmux is found by name), and the installed instance's environment (`K_BENCH_INSTANCE=installed`, port 7680, tmux socket `k-bench`). Logs go to `~/Library/Logs/k-bench/k-bench.log`;
- your tailnet login, read from `tailscale status --json`, is recorded in the plist as `K_BENCH_ALLOWED_LOGIN` (`--login you@example.com` skips the lookup);
- `tailscale serve --bg --https=443 http://127.0.0.1:7680` publishes it at `https://<this machine>.<tailnet>.ts.net/`. This replaces whatever `tailscale serve` already publishes at port 443 of this machine.

It never touches `./.data/` or the `k-bench-dev` tmux socket.

### Update

`git pull`, then `pnpm install-app` again. The app folder is replaced and the agent reloaded in place; Sessions live in tmux, which the agent abandons rather than kills, so every Session keeps running. Open browser tabs reconnect on their own.

### The Dev instance on the tailnet

To try the Dev instance (for example the phone layout) before installing:

```sh
pnpm build
K_BENCH_ALLOWED_LOGIN=you@example.com pnpm dev
pnpm dev:serve               # tailscale serve on https port 8443; --off stops it, --dry-run only prints
```

This publishes the Dev server itself (127.0.0.1:7690), not Vite, so the same `Tailscale-User-Login` check applies; it serves the last `pnpm build`. Open `https://<this machine>.<tailnet>.ts.net:8443/`.

### Manual verification checklist

The install changes the real system, so it is checked by hand, not by automated tests (only its pure parts are unit-tested in `test/install.test.ts`). Create a couple of Sessions first, then:

1. After `pnpm install-app`, k-bench opens at the tailnet HTTPS URL from your phone.
2. A request from another tailnet identity, or with no Tailscale identity, is refused with 403 (for example `curl http://127.0.0.1:7680/api/state` on the Host, which sends no identity).
3. `launchctl kickstart -k gui/$(id -u)/com.k-bench.server` restarts k-bench and every Session is still running.
4. Run `pnpm install-app` again: every Session is still running.
5. Log out and in again (or reboot): the service is back. After a logout and login Sessions are running; after a reboot they show Stopped.
6. `pnpm dev:serve` publishes the Dev instance on port 8443 and the same login check refuses other identities.
7. Throughout, the Dev instance's `./.data/` and `k-bench-dev` socket are untouched by the install, and the Installed instance's data and `k-bench` socket are untouched by `pnpm dev` and `pnpm test`.

To remove the install: `launchctl bootout gui/$(id -u)/com.k-bench.server`, delete the plist, `tailscale serve --https=443 off`, and delete `~/Library/Application Support/k-bench/app` (the database and tmux sessions stay).

## Layout

- `scripts/`: `dev.mjs` (`pnpm dev`), `dev-serve.ts` (`pnpm dev:serve`), `install.ts` (`pnpm install-app`) with its pure, unit-tested parts in `install-lib.ts`, and `fix-node-pty.mjs`.
- `src/server/`: `config.ts` (instance config), `access-guard.ts` (the `Tailscale-User-Login` check, ADR-0003), `store.ts` (SQLite and migrations), `tmux.ts` (tmux driver), `reconciler.ts` (kills tmux sessions with no store row, at startup and on every state read), `service.ts` (domain operations), `app.ts` (HTTP API), `static.ts` (serves the built front end), `terminal.ts` (terminal WebSocket), `state-feed.ts` (change detection: re-reads the state after a mutation and on a short poll, and hands each changed snapshot to subscribers), `events.ts` (events WebSocket), `server.ts` (`startServer`), `main.ts` (entry point).
- `web/`: the front end (Vite, React, Tailwind, shadcn/ui, Lucide, xterm.js). `src/App.tsx` is the shell, `src/components/` holds `Sidebar`, `NewWorkspaceDialog`, `WorkspaceRow` (a sortable Workspace row with its menu), `EditWorkspaceDialog`, `DeleteWorkspaceDialog`, `SessionRow`, `PaneArea` (one or two Panes with a draggable divider), `Pane` (a Session's terminal in one slot) and `TerminalView` (xterm.js on the terminal WebSocket), `src/components/ui/` the shadcn/ui components, `src/api.ts` the API client, `src/layout.ts` the per-device Pane layout (a `Layout` value plus pure functions such as `openInFocusedPane`, `openInOtherPane`, `togglePaneCount`, `moveFocus`, `setRatio`, and `useLayout()` which keeps it in browser storage). `@/` aliases `web/src/`.
- `test/`: outcome-based tests, see `docs/testing.md`.
- `test/harness/`: the Seam 1 harness. `createTestInstance()` gives an isolated instance (temp data folder, unique `kb-test-*` tmux socket) that is cleaned up after each test; `instance.start()` boots the real server in-process and can be called again after `stop()` to simulate a restart; every request and upgrade carries the instance's configured login in `Tailscale-User-Login` by default (`server.as(login)` and `server.anonymous()` give views that send another login or none, `server.upgradeStatus(path)` reports the status refusing an upgrade); `server.openEvents()` returns an `EventsClient` (collected snapshots, `waitForSnapshot()`); `server.openTerminal()` returns a `TerminalClient` with `run()`, `resize()` and `waitForOutput()`; `pollUntil()` waits for outcomes. `test/harness/tmux.ts` kills a test instance's tmux server (a Host reboot), plants a tmux session the store does not know, and lists the socket's sessions; it refuses any socket not named `kb-test-*`.

## Playwright tests (Seam 2)

`e2e/harness.ts` exports `test` and `expect`. Its `kbench` fixture boots an isolated server in-process (temp data folder, unique `kb-test-*` tmux socket, random port) serving `dist/web`, and sets the `Tailscale-User-Login` header on the browser context; the `app` fixture is an `AppPage` already open on the app (`otherDevice` is a second one in another browser context), with helpers that find things by role and accessible name (`createWorkspace()`, `createSession()`, `session()`, `sessionStatus()`, `sessionMenu()`, `terminal()`, `runMarker()`, `terminalSize()`). To add a test, write `e2e/<topic>.spec.ts`, import `test`/`expect` from `./harness.ts`, and add any new UI helper to `AppPage`. Use `kbench.instance.makeFolder()` for Workspace folders.

## API (so far)

- `GET /api/state`: Workspaces with their Sessions (`running` or `stopped`).
- `POST /api/sessions/:id/restart`: starts a fresh shell for a Stopped Session in its Workspace folder, same id and name (a running Session is left alone; 422 when the folder is gone).
- `GET /api/directories?path=`: the subfolders of `path` (default: the configured picker root) for the folder picker; 422 if the path is not an existing absolute folder.
- `POST /api/workspaces` `{folder, name?}`: the name defaults to the folder name, with a "(2)"-style suffix when taken; an explicit name that is taken gets 409, a missing folder 422. And `POST /api/workspaces/:id/sessions` `{name?}`.
- `PATCH /api/workspaces/:id` `{name?, folder?}`: rename and/or change the folder; 409 for a taken name, 422 for a blank name or a folder that does not exist (neither change is made if one is refused), 404 for an unknown Workspace.
- `PUT /api/workspaces/order` `{ids}`: the full ordered list of Workspace ids (422 unless it is every Workspace exactly once).
- `DELETE /api/workspaces/:id`: ends every Session's shell, then removes the Workspace (204). The folder on disk is never touched.
- `PATCH /api/sessions/:id` `{name}` renames a Session (409 if the name is taken in its Workspace, 422 if empty); `DELETE /api/sessions/:id` ends its shell and removes it (204). Session names are unique per Workspace; created without a name, a Session gets "session N" with the next free N.
- `GET /api/sessions/:id/terminal?cols=&rows=` (WebSocket): output arrives as binary frames; send JSON text frames `{"type":"input","data":"..."}` or `{"type":"resize","cols":120,"rows":30}`. Close code 4404 means the Session no longer exists, 4410 that it is Stopped.
- `GET /api/events` (WebSocket): sends the full state (same shape as `GET /api/state`) as a JSON text frame on connect and again whenever it changes, whether from a request on any device or from something tmux-side such as a shell exiting. Clients send nothing.

## Access

Every HTTP request and WebSocket upgrade must carry `Tailscale-User-Login` equal to `K_BENCH_ALLOWED_LOGIN`, otherwise it gets 403. With no login configured, everything is refused. The server listens on `127.0.0.1` only.
