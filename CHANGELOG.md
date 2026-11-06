# Changelog

All notable changes to k-bench are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and k-bench uses [semantic versioning](https://semver.org/).

Add notes under Unreleased as you change things. `pnpm release <version>` moves them under the new version when it prepares a release (see [Releasing](docs/internals/releasing.md)).

## [Unreleased]

### Added

- Claude Sessions: a Workspace's **+** is now a menu with **New shell** (as before) and **New Claude…**, which opens a dialog with an optional name and a Launch button. A Claude Session runs Claude Code itself in the Workspace's folder, through your login shell, and opens in the Focused Pane. The sidebar marks it with a small Claude glyph. Quitting Claude Code makes the Session Stopped; if Claude Code exits with an error, the Session keeps the error on screen until you press a key.

### Changed

- The server's dependencies (`hono`, `@hono/node-server`, `ws` and `node-pty`) are now pinned to exact versions, so `npm i -g @k-electron/k-bench` and `k-bench install` run the versions k-bench was tested with instead of resolving newer ones on the day you install. Updated `@hono/node-server` to 2.1.6.

### Fixed

- Narrowing the window to phone width, or rotating a large phone to portrait, no longer throws away the second Pane. Widening it again brings back both Panes, their Sessions, the Focused Pane and the divider where they were.
- Opening a Session while the window is narrowed to phone width no longer drops the second Pane: the Pane that was focused shows the new Session, and widening the window brings back both.
- Reloading right after dragging the divider between Panes no longer brings it back a little short of where you left it.

## [0.1.3] - 2026-11-04

### Added

- A favicon: a lowercase k on a dark square. It also serves as the icon when you add k-bench to a phone's home screen.
- The bar above the Panes shows which Session each Pane holds, as `Workspace › Session`, starting at that Pane's left edge. A long name is cut off with `…` at about two thirds of the Pane's width, and with two Panes the unfocused Pane's label is dimmed. The browser tab is titled after the Focused Pane's Session.

### Changed

- Touch scrolling follows your finger line by line, and a flick keeps gliding after you lift it, slowing down the way iPhone lists do and then settling to a stop. Another flick while it glides speeds it up, and a touch stops it without opening the keyboard. Desktop wheel and trackpad scrolling through History feel as before, but full-screen programs that read the wheel themselves (such as vim or less) now scroll five of their steps per wheel step.

## [0.1.2] - 2026-11-04

### Fixed

- On a phone, the on-screen keyboard no longer covers the bottom of the terminal. While it is up, the app fits the space above it (so the cursor line stays visible, on iPhone as on Android), the header and the full Extra keys row are hidden, and a compact overlay in the terminal's top-right corner gives Esc, Tab, Enter, a close-keyboard key and the arrows. Ctrl and ⇧Tab return with the keyboard down. The Session resizes to match while the keyboard is up.

## [0.1.1] - 2026-11-04

### Fixed

- New Sessions start in their Workspace folder after upgrading k-bench. Upgrading deleted the folder the running tmux server was started from, and from then on every new Session's shell opened in that deleted folder (showing `/` and a `getcwd` error) instead of its Workspace folder.

## [0.1.0] - 2026-11-03

First public release. k-bench is a web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on the Host (a Mac), organised into Workspaces. It runs real programs in real terminals, Claude Code included, so nothing is hidden behind a wrapper.

### Added

- Workspaces: named entries that point at project folders on the Host. Add one with the folder picker, rename it, change its folder, reorder Workspaces by dragging, or delete it (its Sessions end; the folder on disk is never touched). A Workspace whose folder has gone is Missing, and its Sessions can't start until the folder is fixed, while everything else keeps working.
- Sessions: named, persistent shells inside a Workspace, started in its folder. A Session keeps running when no browser is viewing it, so long jobs and Claude conversations carry on. Rename, delete and restart them. A Session whose shell has gone (it exited, or the Host rebooted or logged out) is Stopped; restart it from its menu as a fresh shell in the same folder. After a logout or restart k-bench comes back on its own when you log in, with everything still listed and every Session Stopped.
- Two Panes: show two Sessions side by side on a wide screen, with a Focused Pane that opening a Session from the sidebar targets. On a phone there is a single Pane.
- Bells: a Session raises a Bell when its shell rings the terminal bell, shown on its row in the sidebar (and on a collapsed Workspace), and cleared once you view that Session.
- Phone layout: a drawer for the Workspaces and Sessions, and a row of extra keys for the keys a phone keyboard lacks.
- Live updates: every open browser tab reflects Session and Workspace changes at once, and reconnects on its own after k-bench restarts or updates.
- Tailnet-only access: k-bench listens on localhost and is published through `tailscale serve`. It admits only requests carrying the owner's own tailnet login and refuses cross-origin requests. There is no password, LAN or other tunnel mode.
- The `k-bench` command, installed from npm with `npm i -g @k-electron/k-bench`:
  - `k-bench install` installs or updates the background service (a LaunchAgent that starts at login) and publishes it with `tailscale serve`. It finds your tailnet login automatically, stops rather than replacing a different service already on the HTTPS port (`--https-port` picks another port, `--force` replaces it), replaces its own earlier install without `--force`, and prints the URL. `--dry-run` shows every change first.
  - `k-bench uninstall` stops the service and removes its login item and its own `tailscale serve` entry, keeping your Workspaces, Sessions and data. `--purge` also deletes the data and the logs and ends every Session. `--dry-run` shows what it would remove.
  - `k-bench status` checks tmux, Tailscale (running, logged in, HTTPS certificates), the service and the installed version, prints the URL, and exits non-zero when something is wrong.
- Updating is two commands: upgrade the npm package, then run `k-bench install` again. Running Sessions keep running through an update.
- A README and a [user guide](https://github.com/k-electron/k-bench/blob/main/docs/guide/README.md): setup (Tailscale and its HTTPS certificates, installing, updating, uninstalling), daily use, using k-bench with Claude Code, and troubleshooting.
- Requirements: macOS, Node 26 or later, tmux and Tailscale with HTTPS certificates enabled.

[Unreleased]: https://github.com/k-electron/k-bench/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/k-electron/k-bench/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/k-electron/k-bench/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/k-electron/k-bench/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/k-electron/k-bench/releases/tag/v0.1.0
