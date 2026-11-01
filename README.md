# k-bench

A web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on your Mac, organised into Workspaces. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the design decisions.

## Requirements

- macOS, Node 26 or later, pnpm
- tmux (`brew install tmux`)

## Commands

```sh
pnpm install     # also restores the execute bit on node-pty's spawn-helper
pnpm dev         # Dev instance: server (watch mode) on port 7690 plus Vite on :5173, which proxies /api; data in ./.data, tmux socket "k-bench-dev"
pnpm build       # production front end into dist/web
pnpm start       # the server alone; serves dist/web when it exists
pnpm lint        # Biome
pnpm typecheck   # tsc, for the server/tests and for the front end (web/)
pnpm test        # Vitest (Seam 1, the server)
pnpm test:e2e    # Playwright (Seam 2, the browser); builds the front end first
```

The access guard refuses requests without the right `Tailscale-User-Login`, so run `pnpm dev` with `K_BENCH_ALLOWED_LOGIN=you@example.com`: Vite's proxy then adds that header to `/api` requests, standing in for `tailscale serve`.

Playwright needs its browser once: `pnpm exec playwright install chromium`.

`K_BENCH_INSTANCE` (`dev` by default, or `installed`) selects an instance preset. `K_BENCH_DATA_DIR`, `K_BENCH_TMUX_SOCKET`, `K_BENCH_PORT`, `K_BENCH_ALLOWED_LOGIN` and `K_BENCH_PICKER_ROOT` each override one value.

## Layout

- `src/server/`: `config.ts` (instance config), `access-guard.ts` (the `Tailscale-User-Login` check, ADR-0003), `store.ts` (SQLite and migrations), `tmux.ts` (tmux driver), `service.ts` (domain operations), `app.ts` (HTTP API), `static.ts` (serves the built front end), `terminal.ts` (terminal WebSocket), `server.ts` (`startServer`), `main.ts` (entry point).
- `web/`: the front end (Vite, React, Tailwind, shadcn/ui, Lucide, xterm.js). `src/App.tsx` is the shell, `src/components/` holds `Sidebar`, `NewWorkspaceDialog`, `Pane` (one slot in the main view) and `TerminalView` (xterm.js on the terminal WebSocket), `src/components/ui/` the shadcn/ui components, `src/api.ts` the API client, `src/layout.ts` the per-device layout kept in browser storage. `@/` aliases `web/src/`.
- `test/`: outcome-based tests, see `docs/testing.md`.
- `test/harness/`: the Seam 1 harness. `createTestInstance()` gives an isolated instance (temp data folder, unique `kb-test-*` tmux socket) that is cleaned up after each test; `instance.start()` boots the real server in-process and can be called again after `stop()` to simulate a restart; every request and upgrade carries the instance's configured login in `Tailscale-User-Login` by default (`server.as(login)` and `server.anonymous()` give views that send another login or none, `server.upgradeStatus(path)` reports the status refusing an upgrade); `server.openTerminal()` returns a `TerminalClient` with `run()`, `resize()` and `waitForOutput()`; `pollUntil()` waits for outcomes.

## Playwright tests (Seam 2)

`e2e/harness.ts` exports `test` and `expect`. Its `kbench` fixture boots an isolated server in-process (temp data folder, unique `kb-test-*` tmux socket, random port) serving `dist/web`, and sets the `Tailscale-User-Login` header on the browser context; the `app` fixture is an `AppPage` already open on the app, with helpers that find things by role and accessible name (`createWorkspace()`, `createSession()`, `session()`, `terminal()`, `runMarker()`, `terminalSize()`). To add a test, write `e2e/<topic>.spec.ts`, import `test`/`expect` from `./harness.ts`, and add any new UI helper to `AppPage`. Use `kbench.instance.makeFolder()` for Workspace folders.

## API (so far)

- `GET /api/state`: Workspaces with their Sessions (`running` or `stopped`).
- `GET /api/directories?path=`: the subfolders of `path` (default: the configured picker root) for the folder picker; 422 if the path is not an existing absolute folder.
- `POST /api/workspaces` `{folder, name?}`: the name defaults to the folder name, with a "(2)"-style suffix when taken; an explicit name that is taken gets 409, a missing folder 422. And `POST /api/workspaces/:id/sessions` `{name?}`.
- `GET /api/sessions/:id/terminal?cols=&rows=` (WebSocket): output arrives as binary frames; send JSON text frames `{"type":"input","data":"..."}` or `{"type":"resize","cols":120,"rows":30}`. Close code 4404 means the Session no longer exists, 4410 that it is Stopped.

## Access

Every HTTP request and WebSocket upgrade must carry `Tailscale-User-Login` equal to `K_BENCH_ALLOWED_LOGIN`, otherwise it gets 403. With no login configured, everything is refused. The server listens on `127.0.0.1` only.
