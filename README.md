# k-bench

A web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on your Mac, organised into Workspaces. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the design decisions.

## Requirements

- macOS, Node 26 or later, pnpm
- tmux (`brew install tmux`)

## Commands

```sh
pnpm install     # also restores the execute bit on node-pty's spawn-helper
pnpm dev         # Dev instance: data in ./.data, tmux socket "k-bench-dev", port 7690
pnpm lint        # Biome
pnpm typecheck   # tsc
pnpm test        # Vitest
```

`K_BENCH_INSTANCE` (`dev` by default, or `installed`) selects an instance preset. `K_BENCH_DATA_DIR`, `K_BENCH_TMUX_SOCKET`, `K_BENCH_PORT`, `K_BENCH_ALLOWED_LOGIN` and `K_BENCH_PICKER_ROOT` each override one value.

## Layout

- `src/server/`: `config.ts` (instance config), `store.ts` (SQLite and migrations), `tmux.ts` (tmux driver), `service.ts` (domain operations), `app.ts` (HTTP API), `terminal.ts` (terminal WebSocket), `server.ts` (`startServer`), `main.ts` (entry point).
- `test/`: outcome-based tests, see `docs/testing.md`.
- `test/harness/`: the Seam 1 harness. `createTestInstance()` gives an isolated instance (temp data folder, unique `kb-test-*` tmux socket) that is cleaned up after each test; `instance.start()` boots the real server in-process and can be called again after `stop()` to simulate a restart; `server.openTerminal()` returns a `TerminalClient` with `run()`, `resize()` and `waitForOutput()`; `pollUntil()` waits for outcomes.

## API (so far)

- `GET /api/state`: Workspaces with their Sessions (`running` or `stopped`).
- `POST /api/workspaces` `{folder, name?}` and `POST /api/workspaces/:id/sessions` `{name?}`.
- `GET /api/sessions/:id/terminal?cols=&rows=` (WebSocket): output arrives as binary frames; send JSON text frames `{"type":"input","data":"..."}` or `{"type":"resize","cols":120,"rows":30}`. Close code 4404 means the Session no longer exists, 4410 that it is Stopped.
