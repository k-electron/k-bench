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
- `store.ts`: SQLite and migrations, including each Session's kind, a Claude Session's conversation ID and Launch options, and the last-used Launch options.
- `claude.ts`: everything k-bench knows about launching Claude Code (ADR 0005): the flags the Launch options map to, validating them, and the launcher that starts, resumes and holds an error on screen. It never reads Claude Code's output or files.
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
- `launch-options.ts` defines the Launch options, their choices and the all-Default value once, for the server and the New Claude dialog.
- `state-protocol.ts` does the same for state: the snapshot types, the `State-Revision` header, the events path, and decoding a snapshot or a response's revision.

## `web/`

The front end: Vite, React, Tailwind, shadcn/ui, Lucide, xterm.js. `@/` aliases `web/src/`.

- `src/App.tsx` is the shell.
- `src/components/` holds:
  - `Sidebar`, `NewWorkspaceDialog`, `EditWorkspaceDialog`, `DeleteWorkspaceDialog`;
  - `NewClaudeDialog`, the New Claude… dialog (it loads the last-used Launch options when it opens);
  - `WorkspaceRow`, a sortable Workspace row with its menu;
  - `SessionRow`, `BellBadge` and `ClaudeGlyph`;
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
- `src/useIsPhone.ts` is the single desktop/phone breakpoint (767px). On a phone `usePaneView` shows one Pane (the saved layout's Focused Pane), the sidebar as a slide-out drawer opened by the "Menu" button, and `components/ExtraKeys` (Esc, Tab, Shift Tab, one-shot Ctrl, arrows, Enter, as symbols so ten keys fit a 375px row), whose keys and Ctrl state live in `src/terminalInput.ts` and reach the Session's program through the terminal's normal input path. `registerTerminal` there also takes how to end the line Smart typing mirrors, which every Extra key does. The row ends with the Smart typing switch, shown only where Smart typing is offered.
- `src/smartTyping.ts` is Smart typing's per-Session choice: `useSmartTypingOffered()` (iPhone and the phone layout), `useSmartTypingChoice(sessionId)`, `setSmartTyping` and `forgetSmartTypingOfMissing`. The choice is kept in browser storage (`k-bench.smart-typing`, the IDs of the Sessions it is off for; no entry means on), and `usePaneView` forgets the Sessions that no longer exist, as it does for the Pane layout. `TerminalView` turns the mirrored field on for a Session when it is offered and chosen.
- `src/mirroredField.ts` is Smart typing's DOM and xterm.js side (ADR 0006), on for a Session on an iPhone in the phone layout (`isIPhone()`, `useIsPhone()`) unless its owner switched it off (`smartTyping.ts`). `mirrorTypedLine(terminal, kind)` takes the terminal's hidden field over from xterm.js: it keeps the typed text there and sends each change to the Session through `terminal.input`, the path the Extra keys use, so the one-shot Ctrl and input queued while the connection opens apply to it. It also sets the field's keyboard settings from the Session's kind, and returns `clear()` (empties the field from script, then adds the filler: about 120 zero-width spaces before the caret, which count as text already in the program, so deleting one sends a Backspace and a held ⌫ keeps repeating past what was typed; WebKit only resets the keyboard's idea of the text when a page empties the field, hence the empty-then-fill order) and `dispose()` (gives the field back to xterm.js as it was). It relies on `terminal.textarea` and `terminal.element` (it warns and leaves input as it was if the field is missing), on `attachCustomKeyEventHandler`, and on capture-phase listeners on `terminal.element` ahead of xterm.js's own on the field (`input`, composition and `paste` events). A `selectionchange` listener puts a collapsed caret back at the end of the field (not while composing), so a spacebar-drag caret move doesn't swallow the next typed letter. `TerminalView` creates it and clears it on a reconnect; the field also clears on blur, on a key that isn't text, and through `terminalInput.ts` for every Extra key. A new Session means a new terminal and so a new field.
- `src/smartTypingEdit.ts` is the pure part, with no DOM and no xterm.js: the conversion of the keyboard's typographic characters to plain ASCII and `sessionEdit(before, after)`, the Backspaces and new text that turn what the Session has been sent into the field's text.
- `src/touchScroll.ts` turns one-finger drags into whole-line scrolls that follow the finger, and keeps a flick gliding with iOS-style deceleration that settles to an even stop once it is slow (a slow fade in whole lines visibly steps). It knows nothing about xterm.js or tmux.
- `src/wheelReports.ts` turns line counts into mouse-wheel reports through xterm.js, one report per line. tmux is bound to scroll History one line per report (`serverConfiguration` in `src/server/tmux.ts`), so this module also sends five reports per desktop wheel step to keep the desktop feel. The two halves of that pairing point at each other.

## `test/` and `e2e/`

- `test/`: outcome-based tests, see [docs/testing.md](../testing.md).
- `test/harness/`: the Seam 1 harness (and `packed.ts`, the Seam 3 harness, and `fake-claude.sh`, the stand-in for Claude Code), see [Test seams](test-seams.md).
- `e2e/`: the Seam 2 (Playwright) specs and harness, see [Test seams](test-seams.md).
