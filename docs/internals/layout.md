# Source layout

## `scripts/`

- `dev.mjs`: `pnpm dev`.
- `dev-serve.ts`: `pnpm dev:serve`.
- `k-bench.ts`: the `k-bench` command (the package's `bin`); `pnpm install-app` runs `k-bench install`.
- `install.ts`: `k-bench install`, with its pure, unit-tested parts in `install-lib.ts`.
- `smoke.ts`: `pnpm smoke`.
- `release.ts`: `pnpm release <version>`. `release-plan.ts` and `check-npm.ts` are steps of the release workflow; `release-lib.ts` holds the pure parts they share. See [Releasing](releasing.md).
- `fix-node-pty.mjs`: restores the execute bit on node-pty's `spawn-helper`.

The command and the server are compiled to `dist/js` (`pnpm build:server`, `tsconfig.build.json`) for the npm package: see [Packaging](packaging.md).

## `src/server/`

- `config.ts`: instance config.
- `access-guard.ts`: the `Tailscale-User-Login` check, ADR-0003 (see [Access](access.md)).
- `store.ts`: SQLite and migrations.
- `tmux.ts`: the tmux driver, an adapter over the tmux CLI that keeps no state about Sessions, and owns the Bell rule (see [The Bell](bell.md)).
- `reconciler.ts`: kills tmux sessions with no store row, at startup and on every state read.
- `service.ts`: domain operations.
- `app.ts`: the HTTP API (see [The API](api.md)).
- `static.ts`: serves the built front end.
- `attachments.ts`: every browser terminal's life on a Session, from attach to drained on stop.
- `terminal.ts`: the terminal WebSocket, a thin adapter onto `attachments.ts`.
- `state-feed.ts`: change detection. It re-reads the state after a mutation or a Bell change and on a short poll, and hands each changed snapshot to subscribers.
- `events.ts`: the events WebSocket.
- `server.ts`: `startServer`.
- `main.ts`: the entry point.

## `src/shared/`

- `terminal-protocol.ts` defines the terminal WebSocket protocol once; the server, the browser and the tests all import it.

## `web/`

The front end: Vite, React, Tailwind, shadcn/ui, Lucide, xterm.js. `@/` aliases `web/src/`.

- `src/App.tsx` is the shell.
- `src/components/` holds:
  - `Sidebar`, `NewWorkspaceDialog`, `EditWorkspaceDialog`, `DeleteWorkspaceDialog`;
  - `WorkspaceRow`, a sortable Workspace row with its menu;
  - `SessionRow` and `BellBadge`;
  - `PaneArea`, one or two Panes with a draggable divider;
  - `Pane`, a Session's terminal in one slot;
  - `TerminalView`, xterm.js on the terminal WebSocket: wheel and swipe scroll tmux history, OSC 52 copies to the clipboard, shift-drag selects in the browser, and a dropped connection reconnects with backoff behind a "reconnecting…" badge;
  - `ExtraKeys`, for the phone layout (below).
- `src/components/ui/` holds the shadcn/ui components.
- `src/api.ts` is the API client.
- `src/layout.ts` is the per-device Pane layout: a `Layout` value plus pure functions such as `openInFocusedPane`, `openInOtherPane`, `togglePaneCount`, `moveFocus` and `setRatio`, and `useLayout()`, which keeps it in browser storage.
- `src/useIsPhone.ts` is the single desktop/phone breakpoint (767px). On a phone `App.tsx` shows one Pane (the stored layout's Focused Pane), the sidebar as a slide-out drawer opened by the "Menu" button, and `components/ExtraKeys` (Esc, Tab, Shift Tab, one-shot Ctrl, arrows), whose keys and Ctrl state live in `src/terminalInput.ts` and reach the shell through the terminal's normal input path.

## `test/` and `e2e/`

- `test/`: outcome-based tests, see [docs/testing.md](../testing.md).
- `test/harness/`: the Seam 1 harness (and `packed.ts`, the Seam 3 harness), see [Test seams](test-seams.md).
- `e2e/`: the Seam 2 (Playwright) specs and harness, see [Test seams](test-seams.md).
