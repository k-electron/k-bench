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
- `state-protocol.ts` does the same for state: the snapshot types, the `State-Revision` header, the events path, and decoding a snapshot or a response's revision.

## `web/`

The front end: Vite, React, Tailwind, shadcn/ui, Lucide, xterm.js. `@/` aliases `web/src/`.

- `src/App.tsx` is the shell.
- `src/components/` holds:
  - `Sidebar`, `NewWorkspaceDialog`, `EditWorkspaceDialog`, `DeleteWorkspaceDialog`;
  - `WorkspaceRow`, a sortable Workspace row with its menu;
  - `SessionRow` and `BellBadge`;
  - `PaneArea`, one or two Panes with a draggable divider;
  - `Pane`, a Session's terminal in one slot;
  - `PaneLabels`, the top bar's `Workspace › Session` label over each Pane, laid out on the same grid columns as `PaneArea` (`paneColumns` in `src/layout.ts`), so each label follows its Pane and the divider by construction;
  - `TerminalView`, xterm.js on the terminal WebSocket: wheel and touch scroll tmux history (below), OSC 52 copies to the clipboard, shift-drag selects in the browser, and a "reconnecting…" badge shows while the connection retries;
  - `ExtraKeys`, for the phone layout (below).
- `src/components/ui/` holds the shadcn/ui components.
- `src/api.ts` is the API client.
- `src/stateClient.ts` is the state client, with no React: it keeps the events WebSocket connected (backoff, resync), hands each snapshot to subscribers and answers `whenShown(change)`. `src/useAppState.ts` is a thin wrapper that mirrors it into React state and builds the owner's actions.
- `src/terminalConnection.ts` is the terminal's connection, with no React and no xterm.js, the browser's counterpart of the server's `Attachments`: it opens the terminal WebSocket at the terminal's size, keeps input and resizes sent while it is opening until it opens, drops them while a retry waits, reconnects with backoff (and at once when the page is visible or online again), and stops for good when the Session ended. `TerminalView` plugs xterm.js into it.
- `src/layout.ts` is the per-device Pane layout: a `Layout` value plus pure functions such as `openInFocusedPane`, `openInOtherPane`, `stashInOtherPane`, `togglePaneCount`, `moveFocus` and `setRatio`, and `useLayout()`, which keeps it in browser storage. It is the internals of `usePaneView`.
- `src/usePaneView.ts` owns the Panes: it holds the saved layout, forgets deleted Sessions (keeping a notice with the saved Pane they were in), titles the tab, and returns what each visible Pane shows (a Session with its Workspace name, a deleted notice, or empty) along with the intents that change the layout. The components render that and look nothing up. The phone's one-Pane view is applied when reading only and never saved, so on a phone an intent acts on the saved layout's Focused Pane.
- `src/useIsPhone.ts` is the single desktop/phone breakpoint (767px). On a phone `usePaneView` shows one Pane (the saved layout's Focused Pane), the sidebar as a slide-out drawer opened by the "Menu" button, and `components/ExtraKeys` (Esc, Tab, Shift Tab, one-shot Ctrl, arrows), whose keys and Ctrl state live in `src/terminalInput.ts` and reach the shell through the terminal's normal input path.
- `src/touchScroll.ts` turns one-finger drags into whole-line scrolls that follow the finger, and keeps a flick gliding with iOS-style deceleration that settles to an even stop once it is slow (a slow fade in whole lines visibly steps). It knows nothing about xterm.js or tmux.
- `src/wheelReports.ts` turns line counts into mouse-wheel reports through xterm.js, one report per line. tmux is bound to scroll History one line per report (`serverConfiguration` in `src/server/tmux.ts`), so this module also sends five reports per desktop wheel step to keep the desktop feel. The two halves of that pairing point at each other.

## `test/` and `e2e/`

- `test/`: outcome-based tests, see [docs/testing.md](../testing.md).
- `test/harness/`: the Seam 1 harness (and `packed.ts`, the Seam 3 harness), see [Test seams](test-seams.md).
- `e2e/`: the Seam 2 (Playwright) specs and harness, see [Test seams](test-seams.md).
