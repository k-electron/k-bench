# Source layout

## `scripts/`

- `dev.mjs`: `pnpm dev`.
- `dev-serve.ts`: `pnpm dev:serve`.
- `k-bench.ts`: the `k-bench` command (the package's `bin`); `pnpm install-app` runs `k-bench install`.
- `install.ts`: `k-bench install`, with its pure, unit-tested parts in `install-lib.ts`. `uninstall.ts` is `k-bench uninstall` and `status.ts` is `k-bench status`; `command-lib.ts` holds what the three share (the LaunchAgent label, the log, plist and `build-info.json` locations, the `launchctl` and PATH helpers, and the `say`/`step` reporting).
- `tailscale-serve.ts`: reads the `tailscale serve` configuration (pure parsing plus one thin call to the CLI); shared by the `k-bench` commands: see [Packaging](packaging.md#the-tailscale-serve-configuration).
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
  - `PaneLabels`, the top bar's `Workspace › Session` label over each Pane, laid out on the same grid columns as `PaneArea` (`paneColumns` in `src/layout.ts`), so each label follows its Pane and the divider by construction; `locateSession` finds a Session's Workspace, and `App.tsx` also uses it to title the tab after the Focused Pane;
  - `TerminalView`, xterm.js on the terminal WebSocket: wheel and touch scroll tmux history (below), OSC 52 copies to the clipboard, shift-drag selects in the browser, and a dropped connection reconnects with backoff behind a "reconnecting…" badge;
  - `ExtraKeys`, for the phone layout (below).
- `src/components/ui/` holds the shadcn/ui components.
- `src/api.ts` is the API client.
- `src/layout.ts` is the per-device Pane layout: a `Layout` value plus pure functions such as `openInFocusedPane`, `openInOtherPane`, `togglePaneCount`, `moveFocus` and `setRatio`, and `useLayout()`, which keeps it in browser storage.
- `src/useIsPhone.ts` is the single desktop/phone breakpoint (767px). On a phone `App.tsx` shows one Pane (the stored layout's Focused Pane), the sidebar as a slide-out drawer opened by the "Menu" button, and `components/ExtraKeys` (Esc, Tab, Shift Tab, one-shot Ctrl, arrows), whose keys and Ctrl state live in `src/terminalInput.ts` and reach the shell through the terminal's normal input path.
- `src/touchScroll.ts` turns one-finger drags into whole-line scrolls that follow the finger, and keeps a flick gliding with iOS-style deceleration that settles to an even stop once it is slow (a slow fade in whole lines visibly steps). It knows nothing about xterm.js or tmux.
- `src/wheelReports.ts` turns line counts into mouse-wheel reports through xterm.js, one report per line. tmux is bound to scroll History one line per report (`serverConfiguration` in `src/server/tmux.ts`), so this module also sends five reports per desktop wheel step to keep the desktop feel. The two halves of that pairing point at each other.

## `test/` and `e2e/`

- `test/`: outcome-based tests, see [docs/testing.md](../testing.md).
- `test/harness/`: the Seam 1 harness (and `packed.ts`, the Seam 3 harness), see [Test seams](test-seams.md).
- `e2e/`: the Seam 2 (Playwright) specs and harness, see [Test seams](test-seams.md).
