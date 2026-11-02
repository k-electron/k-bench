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
- The **Installed instance** is the copy you use day to day, running in the background on the Host (launchd plus `tailscale serve`). Its data lives in `~/Library/Application Support/k-bench/` and its tmux socket is `k-bench`. Install it with `pnpm install-app` from a checkout, or `k-bench install` from the npm package (see below).

Neither touches the other: the install never touches `./.data/` or the `k-bench-dev` socket, and `pnpm dev` and `pnpm test` never touch the Installed instance's data or the `k-bench` socket.

## Commands

```sh
pnpm install     # also restores the execute bit on node-pty's spawn-helper, and turns on the git hooks in .githooks
pnpm dev         # Dev instance: server (watch mode) on port 7690 plus Vite on :5173, which proxies /api; data in ./.data, tmux socket "k-bench-dev"
pnpm dev:serve   # publish the Dev instance on the tailnet at https port 8443
pnpm build       # production build: the front end into dist/web, the server and the `k-bench` command compiled into dist/js
pnpm build:web   # just the front end (Vite)
pnpm build:server # just the compiled server and command (tsc -p tsconfig.build.json)
pnpm start       # the server alone, run from the TypeScript source; serves dist/web when it exists
pnpm install-app # build and install the Installed instance (launchd + tailscale serve); the same as `k-bench install`; --dry-run to preview
pnpm release <version> # maintainers: open a release PR (bumps the version, moves the changelog notes); --dry-run to preview. See Releasing below
pnpm smoke       # build, then probe the production server on a throwaway instance and clean up; --hold keeps it up for manual requests
pnpm lint        # Biome (warnings fail it too)
pnpm typecheck   # tsc, for the server/tests and for the front end (web/)
pnpm test        # Vitest (Seam 1, the server; Seam 3, the packed `k-bench` command, which builds and packs the package and needs the network)
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
- `pnpm check` is lint, typecheck and the Vitest suite (which builds and packs the package for the packed-command tests, so it needs the network, tmux, and `pnpm` and `npm` on PATH); `pnpm test:e2e` is the Playwright suite. Playwright needs its browser once: `pnpm exec playwright install chromium`.
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

`pnpm install-app` is `k-bench install` run from your checkout: the installer an owner runs from the npm package (`npm i -g @k-electron/k-bench`, then `k-bench install`), except that from a checkout it builds first. [Packaging](docs/internals/packaging.md) describes both. It installs k-bench as the Installed instance:

- the compiled server, the built front end and the production dependencies (`npm install --omit=dev`, so it needs the network; this includes node-pty, with its `spawn-helper` execute bit checked) go to `~/Library/Application Support/k-bench/app/`; the database lives beside it in `~/Library/Application Support/k-bench/`;
- `~/Library/LaunchAgents/com.k-bench.server.plist` is written and (re)loaded: `RunAtLoad`, `KeepAlive`, `AbandonProcessGroup`, the absolute Node path, a PATH that includes `/opt/homebrew/bin` (tmux is found by name), and the installed instance's environment (`K_BENCH_INSTANCE=installed`, port 7680, tmux socket `k-bench`). Logs go to `~/Library/Logs/k-bench/k-bench.log`;
- your tailnet login, read from `tailscale status --json`, is recorded in the plist as `K_BENCH_ALLOWED_LOGIN` (`--login you@example.com` skips the lookup);
- the package version, and from a checkout the commit being installed (and whether there were uncommitted changes), are recorded in `app/build-info.json`, and the server's startup line in the log names them;
- `tailscale serve --bg --https=443 http://127.0.0.1:7680` publishes it at `https://<your-host>.<tailnet>.ts.net/`. This replaces whatever `tailscale serve` already publishes at port 443 of the Host.

It never touches `./.data/` or the `k-bench-dev` tmux socket.

### Update

`git pull`, then `pnpm install-app` again (an owner upgrades the package with `npm i -g @k-electron/k-bench` and runs `k-bench install` again). The agent is stopped, the app folder replaced, and the agent loaded again (so the old server never runs from a half-swapped folder); Sessions live in tmux, which the agent abandons rather than kills, so every Session keeps running. Open browser tabs reconnect on their own.

### Packaging

The npm package ships compiled JavaScript (`dist/js`) and the built front end (`dist/web`), because Node does not strip TypeScript types under `node_modules`. `package.json` carries the package name, the `k-bench` command, the `files` allow-list and `engines`. Its version stays `0.0.0` until a release bumps it, and only the release workflow publishes: never run `npm publish` yourself (the owner's one-off placeholder publish, in [Releasing](docs/internals/releasing.md), is the single exception). `npm pack --dry-run` lists what would ship. To try the package without touching your real npm prefix, run `npm pack`, then `npm install --global --prefix <tmp> ./k-electron-k-bench-<version>.tgz`, and run `<tmp>/bin/k-bench install --dry-run`. [Packaging](docs/internals/packaging.md) explains the build and the install in full.

### The Dev instance on the tailnet

To try the Dev instance (for example the phone layout) before installing:

```sh
pnpm build
K_BENCH_ALLOWED_LOGIN=you@example.com pnpm dev
pnpm dev:serve               # tailscale serve on https port 8443; --off stops it, --dry-run only prints
```

This publishes the Dev server itself (127.0.0.1:7690), not Vite, so the same `Tailscale-User-Login` check applies; it serves the last `pnpm build`. Open `https://<your-host>.<tailnet>.ts.net:8443/`.

### Verifying and removing an install

The install changes the real system, so it is checked by hand: automated tests cover only its pure parts and the packed command's dry run (Seam 3). The checklist, which includes installing from the packed package, and how to remove the install are in [Install verification](docs/internals/install-verification.md).

## Changelog

User-visible changes get a line under Unreleased in [CHANGELOG.md](CHANGELOG.md), in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (Added, Changed, Deprecated, Removed, Fixed, Security). Use the glossary's terms. Do not edit released sections or the version number: `pnpm release` does that.

## Releasing

Maintainers release with `pnpm release <version>` from a clean, up-to-date `main`. It opens a pull request that bumps the version and moves the changelog's Unreleased notes under it; merging that PR runs `.github/workflows/release.yml`, which runs the checks, publishes to npm through trusted publishing with provenance (no npm token), tags `v<version>` and creates the GitHub Release. Pushes to `main` that do not change the version publish nothing, and the workflow also refuses to publish `0.0.0` or while the package does not exist on npm yet. A manual run of the workflow with `dry_run` ticked does everything except publish, tag and release, and prints what it would do.

The process in full, and the one-off npm setup the owner does before the first release (the `k-electron` scope, a `0.0.0` placeholder, and a trusted publisher for the repository `k-electron/k-bench` and the workflow file `release.yml`), is in [Releasing](docs/internals/releasing.md).

## Pull requests

- Work on a branch off `main` and open a pull request against it. Issues and specs live in GitHub Issues.
- Keep the change focused, and use the glossary's terms in code, docs and commit messages.
- Run `pnpm check` and `pnpm test:e2e` before you push; CI runs both on every pull request, and a pull request needs them green.
- Add or change tests as [docs/testing.md](docs/testing.md) describes: few, outcome-level, and able to fail.
- If you change the installer or the packaging, run through the [install verification checklist](docs/internals/install-verification.md) by hand, since automated tests cover only its pure parts and the packed command's dry run.
- Machine-local files (runtime data, logs, `.env*`, build output, editor and agent state) stay out of git. If your change introduces a new kind, update `.gitignore` in the same change.
- Never put a real hostname, tailnet name, login, email or personal path in a commit, issue, pull request or doc; use placeholders such as `<your-host>.<tailnet>.ts.net`, `~/code/...` and `you@example.com`.
- Report security problems privately, not in a pull request or issue: see [SECURITY.md](SECURITY.md).
