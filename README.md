# k-bench

Persistent terminal Sessions on your Mac, organised into Workspaces, reachable from any browser on your tailnet. It launches Claude Code, and resumes it when you restart.

![Claude Code running in a k-bench Session, with the Workspaces and Sessions in the sidebar](docs/images/hero.png)

k-bench is macOS-only, and Tailscale is the only way in. It runs on your Mac as a background service and shows your terminals in a web page that only your own tailnet login can open.

## Why

You can reach Claude Code on your Mac from another device in a few ways, and each trades something away.

- **Claude Code's built-in remote mode.** [Remote Control](https://code.claude.com/docs/en/remote-control) shows a local Claude Code conversation in the Claude app or at claude.ai/code. It needs a claude.ai subscription (API keys are not supported), and some commands that only run in the terminal interface, such as `/plugin` and `/resume`, work only from the local terminal. You use Claude Code through a different interface from the one on your Mac.
- **Tools that wrap Claude Code in their own UI.** Tools in this category give you a purpose-built interface in place of the terminal. That can be easier to use on a phone, but the interface only shows what the tool chose to build: parts of Claude Code, such as the full TUI, your slash commands and hooks, can be missing or behave differently.

k-bench takes a third route. It gives you real Claude Code in a real terminal: persistent, and reachable from any browser on your tailnet. A Session runs your own login shell, or Claude Code itself, with your own PATH and config, so Claude Code, its slash commands, its hooks and everything you have set up behave as they do in your local terminal.

It is not only for Claude Code. **New shell** gives you a plain shell Session, so it works for any terminal workload: a dev server, a test watcher, a deploy, an editor.

## What you get

- **Sessions that keep running** when you close the tab, lock your phone or lose your connection. Come back from any device and pick up where you left off.
- **Claude Sessions.** Pick **New Claude…** from a Workspace's **+**, choose the model, effort, advisor and Focus view (a condensed view that suits a phone), and k-bench launches Claude Code for you. Restart a Stopped Claude Session, even after a reboot, and the same conversation resumes.
- **Workspaces per project.** A Workspace points at a project folder on your Mac, and its Sessions start there.
- **Two Panes** side by side, for example Claude Code next to a dev server.
- **Bells.** When a Session rings the terminal bell, its row in the sidebar shows a Bell until you look at it.
- **A phone layout** with a drawer for your Workspaces and a row of extra keys (Esc, Tab, Shift-Tab, Ctrl, the arrows and Enter) for the keys a phone keyboard lacks.
- **Access only for your tailnet login.** k-bench listens on localhost only and is published with `tailscale serve`. It admits only requests that carry your own tailnet login.

![Two Panes side by side on a desktop: a shell and a dev server](docs/images/desktop.png)

## Quick start

**You need:**

- A Mac (k-bench is macOS-only).
- [Node](https://nodejs.org/) 26 or later.
- tmux (`brew install tmux`).
- [Tailscale](https://tailscale.com/download), signed in, with HTTPS certificates turned on for your tailnet. [Setup](docs/guide/setup.md#1-set-up-tailscale) has the steps.

**Then:**

```sh
npm i -g @k-electron/k-bench
k-bench install
```

`k-bench install` finds your tailnet login by itself, starts k-bench as a background service that starts when you log in, publishes it with `tailscale serve`, and prints the URL it is now reachable at. Open that URL from any device signed in to your tailnet with the same login. To see what the install would do first, run `k-bench install --dry-run`: it changes nothing.

Something not working? Run `k-bench status`: it checks each part and says how to fix what fails.

## Guide

- [The guide](docs/guide/README.md), with
  - [Setup](docs/guide/setup.md): Tailscale, installing, updating, uninstalling.
  - [Using k-bench](docs/guide/using-k-bench.md): Workspaces, Sessions, Claude Sessions, Panes, Bells, scrolling and copying, the phone layout.
  - [Using k-bench with Claude Code](docs/guide/claude-code.md): Claude Sessions and the New Claude dialog, Focus view, resuming on restart, making Claude Code ring the Bell, and working with several conversations.
  - [Troubleshooting](docs/guide/troubleshooting.md): start from `k-bench status`.
- [CHANGELOG](CHANGELOG.md): what changed in each version.

## Security

k-bench is a remote shell: anyone who can open it can run commands on your Mac as you. It is built so that only you can. It listens on `127.0.0.1` only, `tailscale serve` is the only way in, and the server refuses any request that does not carry your own tailnet login, or that comes from a web page on another site. There is no password, no LAN mode and no other tunnel. [Access](docs/internals/access.md) has the details, and [SECURITY.md](SECURITY.md) says how to report a vulnerability privately.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING](CONTRIBUTING.md) covers setup, the checks and the pull request flow. [Internals](docs/internals/README.md) explains how k-bench works inside, [GLOSSARY.md](GLOSSARY.md) holds the vocabulary and [docs/adr/](docs/adr/) the design decisions.

## License

[MIT](LICENSE).
