# Source layout

What each module owns, and any rule that lives only there. The code says how.

## `scripts/`

- `k-bench.ts`: the `k-bench` command. `install.ts`, `uninstall.ts` and `status.ts` are its subcommands, `install-lib.ts` the installer's pure parts, and `command-lib.ts` what the three share. [Packaging](packaging.md) owns how they work.
- `tailscale-serve.ts`: reads the `tailscale serve` configuration, and owns the rule for which entry is k-bench's.
- `dev.mjs` and `dev-serve.ts`: `pnpm dev` and `pnpm dev:serve`, the Dev instance.
- `smoke.ts`: `pnpm smoke`.
- `release.ts`, `release-plan.ts`, `check-npm.ts` and `release-lib.ts`: the release tooling ([Releasing](releasing.md)).
- `fix-node-pty.mjs`: restores the execute bit pnpm drops from node-pty's `spawn-helper`.
- `record-hero.ts` and `scrub-recording.ts`: `pnpm screenshots:record` and `pnpm screenshots:scrub`, which make the README's hero recording and scrub private strings from it.
- `screenshots/`: `pnpm screenshots`, which takes the docs' images with Playwright, one set per `*.shots.ts` file. `demo-home.ts` is the made-up home folder they run in, `privacy.ts` what must never show in an image, `recording.ts` the recording format and `play.ts` its player; `images.ts`, `fixtures.ts` and `global-setup.ts` support them.

## `src/server/`

- `main.ts`: the entry point. `server.ts` wires one instance together and stops it in order.
- `config.ts`: what differs between the Installed instance, the Dev instance and tests.
- `access-guard.ts`: the login and Origin checks ([Access](access.md)).
- `app.ts`: the HTTP API ([The API](api.md)), mapping the service's refusals to status codes.
- `static.ts`: serves the built front end.
- `service.ts`: the domain rules: what may be created, changed, opened, deleted or restarted, and when a Prime and Worker start.
- `store.ts`: the SQLite database and its append-only migrations. It never records whether a Session is running ([ADR 0002](../adr/0002-tmux-is-the-source-of-truth-for-liveness.md)).
- `tmux.ts`: the only module that runs tmux. It keeps no state about Sessions, owns the Bell rule ([The Bell](bell.md)), and binds the wheel to scroll History one line per report.
- `claude.ts`: everything k-bench knows about Claude Code ([ADR 0005](../adr/0005-k-bench-launches-claude-code.md)): the flags the Launch options map to, the `SessionStart` hook and the launcher script.
- `reconciler.ts`: squares the store with tmux. It kills tmux sessions with no store row, and stores the conversation each Claude Session reports.
- `attachments.ts`: a browser terminal's whole life on a Session. `terminal.ts` is the terminal WebSocket, a thin adapter onto it.
- `state-feed.ts`: change detection and revisions for the events WebSocket, `events.ts`.
- `directories.ts`: a folder's subfolders, for the folder picker.
- `naming.ts`: the "(2)"-style suffix for a name already taken.

## `src/shared/`

The server, the browser and the tests all import these, so they use no Node APIs.

- `state-protocol.ts`: the state snapshot, the `State-Revision` header and the events path.
- `terminal-protocol.ts`: the terminal WebSocket's messages and close codes.
- `launch-options.ts`: the Launch options, their choices, the defaults, and the fixed ones a Prime and a Worker get.
- `session-roles.ts`: the one way the server and the browser tell the Prime, the Worker and the Other Sessions apart.

## `web/src/`

Vite, React, Tailwind, shadcn/ui and xterm.js; `@/` aliases `web/src/`. `main.tsx` mounts `App.tsx`, the shell, inside the one `TooltipProvider`. The shell sits inside shadcn/ui's `SidebarProvider`, with everything beside the sidebar in its `SidebarInset`, and picks the desktop layout or the Phone layout. `index.css` is the global styles and the theme tokens, `lib/utils.ts` shadcn/ui's class helper, and `lib/focus.ts` decides whether a closing menu or dialog hands focus back to its trigger. What a Device keeps is in browser storage under `k-bench.*` keys, each owned by the module that reads it.

State and connections:

- `api.ts`: the typed client for the HTTP API.
- `stateClient.ts`: the events WebSocket kept connected, and waiting for a change to show, with no React. `useAppState.ts` mirrors it into React and builds the owner's actions. It lays a right Pane change over every snapshot until one from the Host shows it, so an older snapshot can't swap the Pane back.
- `terminalConnection.ts`: one terminal's WebSocket, with no React and no xterm.js: when it retries and when it stops for good. The browser's counterpart of `attachments.ts`.

Views:

- `workspaceView.ts`: works out the desktop's Panes from the state (what each shows, the Tabs, which is shut, which has the keyboard), and components render what it says. It also owns what runs once per page load at any size: opening the Open Workspace, the browser tab's title, and forgetting stale stored choices.
- `phoneView.ts`: the same for the Phone layout: which Session of the Open Workspace is on screen, kept per Workspace on this Device.
- `workspaces.ts`: what both views and the sidebar read off the state: the Open Workspace, and whether a Workspace has a Bell.
- `folders.ts`: the folder picker's pure path work: Places, breadcrumbs, typed paths and new folder names.
- `useIsPhone.ts`: the one breakpoint for the Phone layout. `useKeyboardUp.ts`: whether the on-screen keyboard is up, and the area the app fits into then. `useSidebarCollapsed.ts`: whether the sidebar is collapsed on this Device, which `App.tsx` hands the `SidebarProvider`.

The terminal:

- `terminalLook.ts`: the terminal's one look ([ADR 0009](../adr/0009-the-terminal-stays-on-xterm-js-drawn-in-the-dom.md)), which `Pane` shares so no seam shows.
- `terminalInput.ts`: input that doesn't come from the keyboard (the Extra keys, the one-shot Ctrl, Paste), sent the way typed keys are.
- `wheelReports.ts`: the only web module that knows tmux scrolls one line per wheel report, the binding in `tmux.ts`.
- `touchScroll.ts`: turns drags and flicks into whole-line scrolls, knowing nothing of xterm.js or tmux.
- `smartTyping.ts`: where Smart typing is offered, and each Session's choice on this Device. `mirroredField.ts` is its DOM and xterm.js side ([ADR 0006](../adr/0006-smart-typing-mirrors-the-typed-line.md)), `smartTypingEdit.ts` the pure comparison that turns a keyboard edit into Backspaces and text.

## `web/src/components/`

Components render what the view modules decide.

- `WorkspaceView`: the desktop's two Panes, the divider and the Rails. `RightPaneTabs` is the right Pane's Tabs. `Pane` is a Session's terminal, or Restart when it is Stopped; `MissingPane` stands in for a Stopped Session of a Missing Workspace.
- `PhoneView`: the Phone layout's Session and title. `ExtraKeys` is the Extra keys row, `TypingKeys` the few that float over the terminal while the on-screen keyboard is up.
- `TerminalView`: xterm.js on a terminal connection, where the terminal modules above plug in.
- `Sidebar`: the sidebar and its menus, on shadcn/ui's `Sidebar`: beside the Panes it collapses to tiles, and in the Phone layout it is the drawer. `SidebarTree` is its expanded rows, `SidebarTiles` its collapsed tiles, `SidebarDialogs` the dialogs its menus open. `Reorderable` is every drag-to-reorder list, so a click, tap or swipe stays itself.
- `NewWorkspaceDialog`, `EditWorkspaceDialog`, `DeleteWorkspaceDialog`, `NewClaudeDialog`, `RenameSessionDialog`, `DeleteSessionDialog`: one dialog each. `FolderPicker` is the folder picker New Workspace and Change folder share.
- `WorkspaceTile`: a Workspace's letter tile, coloured from its name. `SessionIcon`: a Session's icon, by role and kind. `IconButton`: an icon-only button, named in a tooltip except in the Phone layout. `NativeSelect`: a native single choice, so a phone opens its own picker.
- `ui/`: the shadcn/ui components. `ui/sidebar.tsx` differs from shadcn/ui's in three ways: it has no keyboard shortcut, so Ctrl+B always reaches the terminal; it keeps no cookie, since `useSidebarCollapsed.ts` remembers the choice; and it uses `useIsPhone.ts` as its breakpoint.

## `test/` and `e2e/`

- `test/`: the Vitest tests, Seams 1 and 3. `test/harness/` holds their harnesses and `fake-claude.sh`, the stand-in for Claude Code.
- `e2e/`: the Playwright specs and harness, Seam 2.

See [Test seams](test-seams.md) and [Testing](../testing.md).
