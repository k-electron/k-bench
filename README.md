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

`git pull`, then `pnpm install-app` again. The agent is stopped, the app folder replaced, and the agent loaded again (so the old server never runs from a half-swapped folder); Sessions live in tmux, which the agent abandons rather than kills, so every Session keeps running. Open browser tabs reconnect on their own.

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
- `web/`: the front end (Vite, React, Tailwind, shadcn/ui, Lucide, xterm.js). `src/App.tsx` is the shell, `src/components/` holds `Sidebar`, `NewWorkspaceDialog`, `WorkspaceRow` (a sortable Workspace row with its menu), `EditWorkspaceDialog`, `DeleteWorkspaceDialog`, `SessionRow`, `BellBadge`, `PaneArea` (one or two Panes with a draggable divider), `Pane` (a Session's terminal in one slot) and `TerminalView` (xterm.js on the terminal WebSocket: wheel and swipe scroll tmux history, OSC 52 copies to the clipboard, shift-drag selects in the browser, and a dropped connection reconnects with backoff behind a "reconnecting…" badge), `src/components/ui/` the shadcn/ui components, `src/api.ts` the API client, `src/layout.ts` the per-device Pane layout (a `Layout` value plus pure functions such as `openInFocusedPane`, `openInOtherPane`, `togglePaneCount`, `moveFocus`, `setRatio`, and `useLayout()` which keeps it in browser storage). `src/useIsPhone.ts` is the single desktop/phone breakpoint (767px); on a phone `App.tsx` shows one Pane (the stored layout's Focused Pane), the sidebar as a slide-out drawer opened by the "Menu" button, and `components/ExtraKeys` (Esc, Tab, Shift Tab, one-shot Ctrl, arrows), whose keys and Ctrl state live in `src/terminalInput.ts` and reach the shell through the terminal's normal input path. `@/` aliases `web/src/`.
- `test/`: outcome-based tests, see `docs/testing.md`.
- `test/harness/`: the Seam 1 harness. `createTestInstance()` gives an isolated instance (temp data folder, unique `kb-test-*` tmux socket) that is cleaned up after each test; `instance.start()` boots the real server in-process and can be called again after `stop()` to simulate a restart; every request and upgrade carries the instance's configured login in `Tailscale-User-Login` by default (`server.as(login)` and `server.anonymous()` give views that send another login or none, `server.upgradeStatus(path)` reports the status refusing an upgrade); `server.openEvents()` returns an `EventsClient` (collected snapshots, `waitForSnapshot()`); `server.openTerminal()` returns a `TerminalClient` with `run()`, `resize()` and `waitForOutput()`; `pollUntil()` waits for outcomes. `test/harness/tmux.ts` kills a test instance's tmux server (a Host reboot), plants a tmux session the store does not know, lists the socket's sessions, types into a Session with no terminal attached (`typeIntoSession`, how tests ring a Bell nobody watches) and detaches every client (`detachAllClients`); it refuses any socket not named `kb-test-*`.

## Bell

A Session raises a Bell when its shell rings the terminal bell, whether or not any browser is attached. It shows as a badge on the Session row, and as a hint on a collapsed Workspace (the chevron by a Workspace name collapses it). Viewing the Session clears it: `POST /api/sessions/:id/seen`, opening its terminal WebSocket, or a Pane showing a Session whose Bell is raised (the front end calls seen for those).

Mechanism: **a tmux hook**, not a poll (ticket #11 asked for this to be recorded). The tmux driver sets `alert-bell` on the instance's tmux server, which stores the bell in the Session-scoped user option `@kb-bell` (`set-hook -g alert-bell 'if-shell -F "#{==:#{session_attached},0}" "set-option @kb-bell 1"'`). `list-sessions` reads it back with the rest of the live state, so `GET /api/state` and the existing 400ms state poll that feeds the events socket carry it, and clearing is `set-option -u`. Why:

- Verified in `test/bell.test.ts` that tmux runs the hook with no client attached (a plain `printf '\a'` typed into a Session nobody is attached to), so the spec's fallback of polling tmux's own `window_bell_flag` was not needed.
- The Bell lives in tmux (ADR-0002) as an option on the Session, so it survives a k-bench restart and needs no store column. It is lost only when tmux itself dies, when the Session is Stopped anyway.
- tmux's own bell flag can't be cleared with no client attached (re-selecting the current window is a no-op), so polling it would have needed a window-switching workaround. The option clears with one command.
- The `session_attached == 0` condition means a bell rung while a client is viewing the Session is never recorded, so it can't linger unseen. The terminal WebSocket clears after attaching, so the attach itself leaves nothing stale.

Known limitation: `session_attached` counts every attached client, on any device, not clients that are actually showing the Session. A stale browser tab (or a laptop left open) with the Session's terminal still connected suppresses the Bell while you are elsewhere. This is the deliberate trade-off above, a bell rung while someone is looking must not linger. Close the stale tab to get Bells again.

The events socket's 400ms poll runs `getState()` (one `tmux list-sessions`, a `stat` per Workspace, the orphan check) only while some browser is subscribed. That is a deliberate cost of noticing shells that exit and Bells with no request to announce them; it is cheap at this scale and has not been tuned.

## Playwright tests (Seam 2)

`e2e/harness.ts` exports `test` and `expect`. Its `kbench` fixture boots an isolated server in-process (temp data folder, unique `kb-test-*` tmux socket, random free port, so `kbench.stopServer()` and `kbench.startServer()` can restart it at the same address) serving `dist/web`, and sets the `Tailscale-User-Login` header on the browser context; the `app` fixture is an `AppPage` already open on the app (`otherDevice` is a second one in another browser context), with helpers that find things by role and accessible name (`createWorkspace()`, `createSession()`, `session()`, `sessionStatus()`, `sessionMenu()`, `terminal()`, `runMarker()`, `runCommand()`, `terminalSize()`). Playwright has two projects: `desktop` (1280x800, every spec except `phone.spec.ts`) and `phone` (a Pixel 7: touch, 412px wide, runs only `e2e/phone.spec.ts`; `AppPage` has `openDrawer()`, `drawer` and `extraKey(name)` for it, and the phone's sidebar is hidden until the drawer is open). To add a test, write `e2e/<topic>.spec.ts`, import `test`/`expect` from `./harness.ts`, and add any new UI helper to `AppPage`. Use `kbench.instance.makeFolder()` for Workspace folders.

## API (so far)

- `GET /api/state`: Workspaces with their Sessions (`running` or `stopped`, and `bell`).
- `POST /api/sessions/:id/seen`: the Session has been viewed; clears its Bell (204, 404 for an unknown Session). Opening the Session's terminal WebSocket does the same.
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

A request that carries an `Origin` header must name the same host as its `Host` header, otherwise it gets 403. `tailscale serve` adds the owner's login to anything their browser sends, so without this a web page on another site could open the terminal WebSocket and run commands. Behind `tailscale serve`, `Host` and `Origin` are both the tailnet name; behind the Vite dev proxy both are `localhost:5173`; clients that send no `Origin` (curl, tests, the install health check) are unaffected. A request body must be declared `application/json` (415 otherwise).
