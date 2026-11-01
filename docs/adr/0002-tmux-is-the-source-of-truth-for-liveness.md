# The database stores no process IDs; tmux is the only record of what is running

The original brief asked for a store holding Sessions' process IDs. We deliberately don't do that: two records of what's running would disagree. SQLite holds only what the user chose: Workspaces (name, folder, order) and Sessions (name, order, Workspace, and a stable ID that is also the Session's tmux session name). Whether a Session is running or Stopped is read from tmux. On startup the server reconciles the two: a Session with no tmux session is Stopped, and a tmux session with no row is cleaned up.
