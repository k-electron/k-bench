# tmux owns the terminals; the web app is only a client

Sessions must outlive the web app, browser tabs, and server restarts, so the web app never owns a terminal process. Every Session is a tmux session on a dedicated socket (`tmux -L k-bench`, `-L k-bench-dev` for development, with the status bar hidden). The server attaches to it with `tmux attach` under `node-pty`, one attachment per open Pane. tmux redraws the full screen on re-attach and is mature and scriptable.

## Considered Options

- **zellij**: more modern, but harder to drive from a script and embed.
- **dtach / abduco**: they keep a process alive, but on re-attach they don't redraw the screen and there's no scrollback.
- **Our own PTY daemon**: we'd be rebuilding tmux.

## Consequences

- The browser terminal's scrollback stays empty, because tmux owns the screen. Scrolling and copying go through tmux mouse mode and OSC 52 clipboard passthrough, with shift-drag as a fallback that selects in the browser terminal directly.
- The installed server runs as a launchd agent, and launchd by default kills a job's whole process group when the job stops. tmux must be started outside the server's process group, or the plist must set `AbandonProcessGroup`. Otherwise restarting k-bench kills every Session.
- Sessions start the user's login shell, so they get the full PATH even though launchd provides a bare environment.
