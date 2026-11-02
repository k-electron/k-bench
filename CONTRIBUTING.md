# Contributing to k-bench

k-bench is a web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on the Host (a Mac), organised into Workspaces. See `GLOSSARY.md` for the vocabulary, which these docs and the code use throughout, and `docs/adr/` for the design decisions. How it works inside is in [the internals docs](docs/internals/README.md).

## Prerequisites and setup

- macOS, Node 26 or later, pnpm
- tmux (`brew install tmux`)
- Tailscale, to install it as a service (see [Install from a checkout](#install-from-a-checkout))

Then, in your checkout:

```sh
pnpm install                              # once, and after pulling dependency changes
pnpm exec playwright install chromium     # once: Playwright needs its browser
```

`pnpm install` also restores the execute bit on node-pty's `spawn-helper` and turns on the git hooks in `.githooks`.

## The two instances

k-bench runs as one of two fully separate instances, so that working on it never touches the Sessions you are working in:

- The **Dev instance** is a copy run from your checkout with `pnpm dev`. Its data lives in `./.data/` and its tmux socket is `k-bench-dev`, and restarting it never touches the Installed instance.
- The **Installed instance** is the copy you use day to day, running in the background on the Host (launchd plus `tailscale serve`). Its data lives in `~/Library/Application Support/k-bench/` and its tmux socket is `k-bench`. Install it with `pnpm install-app` (see below).

Neither touches the other: the install never touches `./.data/` or the `k-bench-dev` socket, and `pnpm dev` and `pnpm test` never touch the Installed instance's data or the `k-bench` socket.

## Commands

```sh
pnpm install     # also restores the execute bit on node-pty's spawn-helper, and turns on the git hooks in .githooks
pnpm dev         # Dev instance: server (watch mode) on port 7690 plus Vite on :5173, which proxies /api; data in ./.data, tmux socket "k-bench-dev"
pnpm dev:serve   # publish the Dev instance on the tailnet at https port 8443
pnpm build       # production front end into dist/web
pnpm start       # the server alone; serves dist/web when it exists
pnpm install-app # build and install the Installed instance (launchd + tailscale serve); --dry-run to preview
pnpm smoke       # build, then probe the production server on a throwaway instance and clean up; --hold keeps it up for manual requests
pnpm lint        # Biome (warnings fail it too)
pnpm typecheck   # tsc, for the server/tests and for the front end (web/)
pnpm test        # Vitest (Seam 1, the server)
pnpm test:e2e    # Playwright (Seam 2, the browser); builds the front end first
pnpm check       # lint + typecheck + test
```

### Running the Dev instance

The access guard refuses requests without the right `Tailscale-User-Login`, so run `pnpm dev` with `K_BENCH_ALLOWED_LOGIN=you@example.com`: Vite's proxy then adds that header to `/api` requests, standing in for `tailscale serve`.

```sh
K_BENCH_ALLOWED_LOGIN=you@example.com pnpm dev
```

### Environment variables and instance presets

`K_BENCH_INSTANCE` (`dev` by default, or `installed`) selects an instance preset. `K_BENCH_DATA_DIR`, `K_BENCH_TMUX_SOCKET`, `K_BENCH_PORT`, `K_BENCH_ALLOWED_LOGIN` and `K_BENCH_PICKER_ROOT` each override one value (`K_BENCH_PICKER_ROOT` is the folder the folder picker starts at, your home folder by default).

The `installed` preset is port 7680, tmux socket `k-bench` and the data folder `~/Library/Application Support/k-bench/`; the `dev` preset is port 7690, tmux socket `k-bench-dev` and `./.data/`.

## Checks and CI

- Every commit runs Biome on the staged files and the typecheck (`.githooks/pre-commit`).
- `pnpm check` is lint, typecheck and the Vitest suite; `pnpm test:e2e` is the Playwright suite. Playwright needs its browser once: `pnpm exec playwright install chromium`.
- CI (`.github/workflows/ci.yml`, macOS) runs `pnpm check` and `pnpm test:e2e` on every push to `main` and every pull request.
- How to write tests, and what a good one is, is in [docs/testing.md](docs/testing.md). The harnesses are described in [Test seams](docs/internals/test-seams.md).

## Install from a checkout

To use your checkout as the Installed instance (or to try your changes as one):

### Prerequisites

- tmux: `brew install tmux`.
- Tailscale, signed in, with HTTPS certificates enabled for the tailnet (admin console, DNS page). The CLI is found on PATH or inside `/Applications/Tailscale.app`.
- Node 26 or later and pnpm, as above. Run `pnpm install` once in the checkout.

### Install

```sh
pnpm install-app --dry-run   # prints every step and changes nothing
pnpm install-app
```

This builds k-bench and installs it as the Installed instance:

- the server, built assets and production dependencies (including node-pty, with its `spawn-helper` execute bit checked) go to `~/Library/Application Support/k-bench/app/`; the database lives beside it in `~/Library/Application Support/k-bench/`;
- `~/Library/LaunchAgents/com.k-bench.server.plist` is written and (re)loaded: `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, the absolute Node path, a PATH that includes `/opt/homebrew/bin` (tmux is found by name), and the installed instance's environment (`K_BENCH_INSTANCE=installed`, port 7680, tmux socket `k-bench`). Logs go to `~/Library/Logs/k-bench/k-bench.log`;
- your tailnet login, read from `tailscale status --json`, is recorded in the plist as `K_BENCH_ALLOWED_LOGIN` (`--login you@example.com` skips the lookup);
- the commit being installed (and whether there were uncommitted changes) is recorded in `app/build-info.json`, and the server's startup line in the log names it;
- `tailscale serve --bg --https=443 http://127.0.0.1:7680` publishes it at `https://<your-host>.<tailnet>.ts.net/`. This replaces whatever `tailscale serve` already publishes at port 443 of the Host.

It never touches `./.data/` or the `k-bench-dev` tmux socket.

### Update

`git pull`, then `pnpm install-app` again. The agent is stopped, the app folder replaced, and the agent loaded again (so the old server never runs from a half-swapped folder); Sessions live in tmux, which the agent abandons rather than kills, so every Session keeps running. Open browser tabs reconnect on their own.

### The Dev instance on the tailnet

To try the Dev instance (for example the phone layout) before installing:

```sh
pnpm build
K_BENCH_ALLOWED_LOGIN=you@example.com pnpm dev
pnpm dev:serve               # tailscale serve on https port 8443; --off stops it, --dry-run only prints
```

This publishes the Dev server itself (127.0.0.1:7690), not Vite, so the same `Tailscale-User-Login` check applies; it serves the last `pnpm build`. Open `https://<your-host>.<tailnet>.ts.net:8443/`.

### Verifying and removing an install

The install changes the real system, so it is checked by hand, not by automated tests. The checklist, and how to remove the install, are in [Install verification](docs/internals/install-verification.md).

## Pull requests

- Work on a branch off `main` and open a pull request against it. Issues and specs live in GitHub Issues.
- Keep the change focused, and use the glossary's terms in code, docs and commit messages.
- Run `pnpm check` and `pnpm test:e2e` before you push; CI runs both on every pull request, and a pull request needs them green.
- Add or change tests as [docs/testing.md](docs/testing.md) describes: few, outcome-level, and able to fail.
- If you change the installer, run through the [install verification checklist](docs/internals/install-verification.md) by hand, since automated tests cover only its pure parts.
- Machine-local files (runtime data, logs, `.env*`, build output, editor and agent state) stay out of git. If your change introduces a new kind, update `.gitignore` in the same change.
- Never put a real hostname, tailnet name, login, email or personal path in a commit, issue, pull request or doc; use placeholders such as `<your-host>.<tailnet>.ts.net`, `~/code/...` and `you@example.com`.
- Report security problems privately, not in a pull request or issue: see [SECURITY.md](SECURITY.md).
