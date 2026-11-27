# Changelog

All notable changes to k-bench are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and k-bench uses [semantic versioning](https://semver.org/).

Add notes under Unreleased as you change things. `pnpm release <version>` moves them under the new version when it prepares a release (see [Releasing](docs/internals/releasing.md)).

## [Unreleased]

## [0.5.0] - 2026-11-27

### Changed

- Every Claude Session starts in Claude Code's dark theme, on every start and restart, so text the light theme colours near-black, such as the heading of a question, is readable. It applies to that launch only, and your own Claude Code theme setting is left as it is.

### Fixed

- The terminal brightens text that is too close to its background, in every Session, so no program can draw near-invisible text. Colours that were already readable look the same.

## [0.4.1] - 2026-11-26

### Added

- Each Claude Session shows whether it is **Working**, **Waiting** for your answer or **Idle**, live on every Device, wherever the Session shows; Waiting also pulses on its folded Workspace's tile and the phone's menu button. k-bench learns the state from silent hooks it adds to each Claude Code it launches, so nothing reaches the conversation.

### Changed

- A new look outside the terminal: the frame's greys match the terminal's background, with one blue accent, animated dialogs, menus and sidebar, and tooltips on icon-only buttons. The top bar, Tabs, dialogs, folder picker (now with arrow keys and Enter), Sessions sheet and Extra keys are restyled to match, and the terminal looks exactly as before.

### Fixed

- A Session you open in the right Pane stays there. On a slow connection, the Pane could flick back for a moment to what it showed before, then return, and what you typed in the meantime was lost or arrived cut off.

## [0.4.0] - 2026-11-25

### Added

- Every new Workspace comes with a **Prime** and a **Worker**: two Claude Sessions made with the Workspace and lasting as long as it does. k-bench sets their Launch options: the Prime runs Opus at high effort with the advisor off, and the Worker runs Sonnet at high effort with an Opus advisor, both in Focus view. They're passed again on every launch, so a restart never drifts. Neither is started when the Workspace is created: opening the Workspace starts them. They can't be renamed or deleted (their rows have no **Rename** or **Delete**), and no other Session can be named "Prime" or "Worker". Deleting the Workspace ends them with its other Sessions.
- Upgrading gives every existing Workspace a Prime and a Worker too, both Stopped, so old and new Workspaces work the same. Nothing is started by the upgrade. Every existing Session is kept as it was, Claude Sessions included, with its kind, folder and conversation unchanged; none becomes the Prime or Worker. A Session you had already named "Prime" or "Worker" is renamed, for example to "Prime (earlier)".
- **Opening a Workspace** starts its Prime and Worker. Open one by clicking its name in the sidebar; loading k-bench opens the Open Workspace too. A Stopped Prime or Worker is started again, resuming its conversation; one that is running is left alone. The **Open Workspace** is kept on your Mac, so every device knows which Workspace you last opened. Opening a Missing Workspace starts nothing, and fixing its folder while it's open starts both. A Prime or Worker you quit, or that crashes, stays Stopped until you open the Workspace again or press **Restart**. Deleting the Open Workspace opens the first one in your order.

### Changed

- On a desktop or tablet (768 pixels wide and up), the main view now belongs to the **Open Workspace**: its Prime in the left Pane, under a slim **Prime** label, and its Worker in the right Pane. A Session you open from the sidebar, or create, shows in the right Pane, never the left; clicking the Worker brings it back, and clicking the Workspace's name brings back Prime with Worker. The top bar shows the Workspace's name once, with its folder as a tooltip, and the browser tab reads `Workspace — k-bench`. Every device that loads k-bench opens the Open Workspace, so its Prime and Worker are running when you arrive, and opening another Workspace on one device switches the others too.
  - Gone: the Focused Pane, `⌘`-click and **Open in other pane**, `⌘\`, the **Two panes** button and the `Workspace › Session` labels over the Panes. Your old saved Pane layout is thrown away.
- On a phone, the main view now shows **one Session of the Open Workspace**: its Prime, until you show another. The top bar is the menu button and a `Workspace › Session ▾` title, which cuts off the Workspace's name first so the Session's name always shows in full; it replaces the old `Workspace › Session` label. Loading k-bench on a phone opens the Open Workspace, as on a desktop.
  - **Tap the title** to open a sheet of the Open Workspace's Sessions: Prime, Worker, a divider, then the other Sessions in your order, each with its icon, "stopped" when it is and a Bell dot, with the one on screen highlighted. Tap one to show it, or tap outside to close the sheet.
  - **Bell dots** in the top bar: one on the title's Workspace name when another Session of the Open Workspace has a Bell, and one on the menu button when a Session in another Workspace has one. Both can show at once; the Session on screen never counts.
  - In the drawer, tapping a Workspace's name opens it on its Prime, and tapping a Session shows it; either closes the drawer.
  - The phone remembers which Session it was showing in each Workspace, on that phone only and apart from the desktop's right Pane, so a reload puts you back where you were. One that was deleted gives way to the Prime.
  - A Stopped Session on screen shows **Restart**, and a Missing Workspace shows "This Workspace's folder is missing" with **Change folder**, instead of a Restart that fails.
  - The Session you last opened on your phone from another Workspace is forgotten on upgrade: the phone starts on the Open Workspace's Prime.
- **The sidebar is a tree** of every Workspace, in your order, each with a coloured tile of two letters from its name. Only the Open Workspace unfolds, into its **Prime**, its **Worker**, a divider and its other Sessions; click another Workspace's name to open it. Only the Open Workspace's row has **+** (New shell, New Claude…) and **...** (Rename, Change folder, Delete), and **New Workspace** is the **+** in the sidebar's header.
  - Each Session has an icon: a crown for the Prime, a hammer for the Worker, a sparkle for another Claude Session and `>_` for a shell. Sessions shown in a Pane are highlighted, and a Stopped one is dimmed and labelled "stopped".
  - An Other Session's **...** has Restart (when Stopped), Rename and Delete. The Prime and Worker have a **...** only while Stopped, to Restart them.
  - A Session with a Bell shows a bell icon, and a Workspace that isn't open shows an amber dot on its tile when one of its Sessions has a Bell.
  - A Missing Workspace has a warning mark on its tile, and when it's open, a note under it with **Change folder**.
  - Gone: the grip handles, the chevrons that folded a Workspace, and the green and hollow status dots. The phone's drawer shows the same tree.
  - On a desktop or tablet the sidebar **collapses** to a column of tiles about 56 pixels wide, so the Panes get the room: use the button in its header. Under the Open Workspace's tile its Sessions show as small icons, dimmed when Stopped and with an amber dot for a Bell; click a tile to open that Workspace, or an icon to open that Session. The expand button is at the top of the column and **New Workspace** at the bottom. Collapsed or expanded is remembered on each device.
  - **Reorder by dragging the row itself**, with no handles: a Workspace by its row, or by its tile when collapsed, and an Other Session by its row. A drag starts once the mouse moves a few pixels, or after a short press on a touch screen, so a click or tap still opens the row; the lifted row casts a shadow and the others slide aside. The Prime and Worker stay at the top: they can't be dragged, and nothing drops above or between them.
  - Other Sessions now keep **your order**, saved on your Mac, so every device shows it the same. A new Session goes last, and existing ones start in the order they were made.
- The right Pane has a slim **tab bar**: **Worker** first, then a tab for each Other Session you opened there, so you can flip between them. The **×** on a tab removes only the tab, and the Session keeps running; closing the tab that's showing brings back the Worker, which has no ×, and deleting a Session removes its tab. A tab shows an amber dot when its Session rings the Bell while hidden. Clicking the Workspace's name brings back Prime with Worker and keeps the tabs. Each Workspace's tabs, and which one is showing, are kept on your Mac, so they come back when you switch Workspaces and follow you to your other devices.
- Either Pane can be **shut**, so one Claude can have the whole width. The divider now drags anywhere, and dragging it to within about 8% of an edge shuts that Pane, leaving a thin rail with its icon, its name and a Bell dot: a shut Pane's Session can ring its Bell. Click the rail to reopen the Pane where the divider was before; opening the Prime, the Workspace's name, the Worker or an Other Session into a shut Pane reopens it too. Double-click the divider for half and half. The divider and which Pane is shut are remembered for each Workspace on this device, across a reload, and don't follow you to other devices.
- A Pane whose Session is Stopped (the Prime, the Worker or another Session) shows a **Restart** button in place of the terminal, so you can bring it back without the sidebar. In a Missing Workspace it says "This Workspace's folder is missing" instead, in both Panes, with a **Change folder** button that fixes it from there. A Prime or Worker that's starting shows its terminal as soon as it runs, with Claude Code's own startup in it, rather than a Stopped notice first.
- **New Workspace** and **Change folder** pick the folder with a proper folder picker instead of a pasted path or the bare **Browse folders** list. It opens in the folder your newest Workspace is in (or Home), shows one folder's subfolders at a time with breadcrumbs above them and a **Filter** box, and lists **Places**: Home, the folders that hold your Workspaces (most Workspaces first, up to five) and Computer. A folder that already has a Workspace is marked with its name, and the Workspace's name follows the folder you pick until you type your own. On a phone the picker fills the screen, with Places as a row of chips.
- **New folder** in the folder picker makes a new project's folder without leaving k-bench. Name it in the list and press Enter to step into it, where another New folder goes a level deeper. Folders that don't exist yet are shown in italics, and nothing is made on disk until you choose **Create** ("Create 2 folders and Workspace"). Tapping an earlier breadcrumb drops the new folders after it, and a name that already exists just opens that folder. If a folder can't be made, the message names it, no Workspace is created, and the folders already made stay. **Change folder** works the same way.
- **Type or paste a path** in the folder picker: click or tap the breadcrumb bar and it becomes a path field with suggestions from the folder you've typed so far. Tab completes a suggestion, and Enter goes to the path and turns the field back into breadcrumbs, never making anything; any part of the path that doesn't exist becomes new folders, as with New folder. Hidden folders stay out of the list but are offered, greyed out, once you type a `.`.
- **Change folder** now opens at the Workspace's own folder (for a Missing Workspace, the nearest folder above it that still exists), and **Save** waits until you pick a different folder, so a stray click no longer moves the Workspace.
- A folder can have only one Workspace, so a project never gets two sets of Claudes editing the same files. Choosing **Create** on a folder that already has a Workspace says "A Workspace for this folder already exists", naming it, closes the dialog and takes you to that Workspace, making it the Open Workspace. Changing a Workspace's folder to one that another Workspace has is refused with a message naming that Workspace, and nothing changes. Workspaces that already share a folder are left as they are.

### Fixed

- Restarting a Claude Session now resumes the conversation last running in it. After a `/clear`, `/resume`, `/branch` or `/fork` inside Claude Code, a restart used to go back to the conversation the Session was launched with. k-bench now follows the conversation through a silent Claude Code hook it adds to each launch, and saves it at once, whether or not a browser is open. Where Claude Code can't run hooks (a folder you haven't trusted, or `disableAllHooks`), a restart resumes the last conversation k-bench knew, as before.

## [0.3.0] - 2026-11-22

### Added

- A **Paste** key in the phone's floating keys, shown while the on-screen keyboard is up. It pastes the clipboard's text into the Session as a real paste (bracketed when the program asked for it), and the keyboard stays up. **⌄** (close the keyboard) moves to a row of its own below the arrows. Paste is only offered where the browser can read the clipboard; without it, **⌄** stays in the top row.
- Smart typing on iPhone: in the phone layout, the on-screen keyboard's typing aids now work when typing into a Session: autocorrect, tapping a suggestion to swap a word, swipe typing, automatic spacing, double-space for a period and hold to delete. Whatever the keyboard changes reaches the program as Backspaces followed by the new text, so Claude Code's `/` menu and your shell's Tab completion keep working, and nothing new takes room on screen. Curly quotes, long dashes and non-breaking spaces arrive as plain `'`, `"`, `--` and spaces. Shell Sessions get suggestions but no automatic word replacement or capitals (so `ls` stays `ls`); Claude Sessions get all the keyboard's aids. Holding ⌫ keeps deleting, and speeds up, past what you typed, so you can delete text the program put on the line (a Tab-completed path, a recalled command), and a spacebar-drag caret move leaves typing working. Desktop and Android are unchanged.
- A **Smart typing** switch, the last key of the phone's Extra keys row on iPhone, turns Smart typing on or off for the Session you are in. Every new Session starts with it on; turn it off for a Session running vim or less to get plain terminal typing back. Each Session's choice is remembered on that phone and forgotten when the Session is deleted. It takes effect the next time the keyboard opens.

### Changed

- The terminal has a new look: the dark Graphite colour scheme, which matches the app's greys, and the JetBrains Mono font at 13px, bundled with k-bench so nothing is loaded from the internet. The Pane's background matches the terminal's, so no black edge shows around it. A phone keeps all 32 rows and fits 48 columns where it fitted 43. Typing, scrolling, copying and the Extra keys are unchanged.
- The phone's Extra keys row has an **⏎** key that sends Enter, so you can run a line without the on-screen keyboard. Its keys are now narrower symbols (⎋, ⇥, ⇤ for Esc, Tab and Shift-Tab) so they all fit in one row, still 40px tall.

### Fixed

- Emoji such as 🙂 and 👨‍👩‍👧 no longer put the browser's cursor out of step with the Session's, which garbled the line after them.
- Stopping or deleting a Session right as the last running Session ends no longer fails with a server error.
- The state request no longer fails for a moment when the last running Session ends, which could make a client briefly miss the change.
- A Dev instance started from inside Claude Code no longer passes Claude Code's own environment variables to its Sessions, which turned the advisor off in every Claude Session it launched.

## [0.2.0] - 2026-11-05

### Added

- Claude Sessions: launch Claude Code from k-bench and resume it on restart.
  - A Workspace's **+** is now a menu with **New shell** (as before) and **New Claude…**. The dialog takes an optional name, the Launch options and a Launch button, and the new Claude Session opens in the Focused Pane. The sidebar marks it with a small Claude glyph.
  - The Launch options are Model (Default, Fable, Opus, Sonnet or Haiku), Effort (Default, Low, Medium, High, XHigh or Max), Advisor (Default, Off, Fable, Opus or Sonnet) and a Focus view checkbox. Default leaves a setting to your own Claude Code configuration, and Focus view applies to that launch only, without touching your Claude Code settings.
  - The dialog opens with the Launch options you last launched with, on any device, because the Host remembers them. The name is never remembered, and before any Claude Session every option is Default and Focus view is off.
  - A Claude Session runs Claude Code itself in the Workspace's folder, through your login shell, with no shell underneath. Quitting Claude Code makes the Session Stopped; if Claude Code exits with an error, the Session keeps the error on screen until you press a key.
  - Restarting a Stopped Claude Session resumes its Claude conversation with the same Launch options, with no dialog. If you quit before sending a message there is nothing to resume, so it starts a fresh conversation with the same options instead.
  - Existing Sessions stay shell Sessions, and typing `claude` in one still just runs a program: no glyph and no resume.

### Changed

- The README and the guides now describe Claude Sessions: the New Claude dialog, Focus view, the Claude glyph and restart-to-resume, with screenshots of the dialog and the glyph.
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

[Unreleased]: https://github.com/k-electron/k-bench/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/k-electron/k-bench/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/k-electron/k-bench/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/k-electron/k-bench/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/k-electron/k-bench/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/k-electron/k-bench/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/k-electron/k-bench/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/k-electron/k-bench/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/k-electron/k-bench/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/k-electron/k-bench/releases/tag/v0.1.0
