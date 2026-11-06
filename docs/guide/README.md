# The k-bench guide

For someone setting k-bench up and using it. If you want to change k-bench itself, read [CONTRIBUTING](../../CONTRIBUTING.md) and [the internals](../internals/README.md) instead.

k-bench runs on your Mac (the Host), keeps your terminal Sessions going there, and shows them in a browser. It works on macOS only, and the only way in is your own tailnet, through Tailscale.

1. [Setup](setup.md): turn on Tailscale's HTTPS certificates, install k-bench, update it, uninstall it.
2. [Using k-bench](using-k-bench.md): Workspaces, shell Sessions and Claude Sessions, what Stopped and Missing mean, Panes, Bells, scrolling and copying, and the phone layout.
3. [Using k-bench with Claude Code](claude-code.md): launch Claude Code from a dialog and resume it on restart, Focus view, make Claude Code ring the Bell when it is waiting, and how to organise Sessions around Claude conversations.
4. [Troubleshooting](troubleshooting.md): start from `k-bench status`, then the common failures and where the logs are.

New here? Follow the [quick start in the README](../../README.md#quick-start), then read "Using k-bench".

## Words this guide uses

- **Host**: your Mac, which runs k-bench and every Session.
- **Workspace**: a named entry that points at a project folder on the Host.
- **Session**: a named, persistent program inside a Workspace, started in its folder: your shell, or Claude Code for a Claude Session. It keeps running whether or not a browser is showing it.
- **Claude Session**: a Session that runs Claude Code itself, started from **New Claude…** with the Launch options you choose. Restarting it resumes the same Claude conversation.
- **Launch options**: the model, effort, advisor and Focus view a Claude Session starts with. They are fixed for its life.
- **Stopped**: a Session whose program is gone, because it exited or because you logged out of the Host or restarted it. You can restart it in the same folder: a shell starts fresh, and a Claude Session resumes its conversation.
- **Missing**: a Workspace whose folder no longer exists on the Host.
- **Pane** and **Focused Pane**: one of up to two side-by-side slots that each show a Session, and the one that opening a Session from the sidebar goes to.
- **Bell**: a mark on a Session that asks for your attention. It appears when the program in the Session rings the terminal bell, and clears once you view the Session.

[GLOSSARY.md](../../GLOSSARY.md) has the full definitions.
