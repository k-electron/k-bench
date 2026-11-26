# Contributing to k-bench

k-bench is a web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on the Host (a Mac), organised into Workspaces. This page is for changing k-bench. To set it up and use it, start with the [user guide](docs/guide/README.md). The vocabulary is in [GLOSSARY.md](GLOSSARY.md), the design decisions are in [docs/adr/](docs/adr/), and how k-bench works inside is in [the internals](docs/internals/README.md).

## Prerequisites and setup

- macOS, Node 26 or later, pnpm
- tmux (`brew install tmux`)
- Tailscale, set up as in [Setup](docs/guide/setup.md#1-set-up-tailscale), to install k-bench or publish the Dev instance on the tailnet

Then, in your checkout:

```sh
pnpm install                                    # once, and after pulling dependency changes
pnpm exec playwright install chromium webkit    # once: Playwright needs its browsers
```

`pnpm install` also restores the execute bit on node-pty's `spawn-helper` and turns on the git hooks in `.githooks`.

## The two instances

k-bench runs as one of two fully separate instances, so that working on it never touches the Sessions you are working in:

- The **Dev instance** runs from your checkout with `pnpm dev`.
- The **Installed instance** is the copy you use day to day, running in the background on the Host under launchd and published with `tailscale serve`. See [Install from a checkout](#install-from-a-checkout).

| Instance           | Port | tmux socket   | Data                                     |
| ------------------ | ---- | ------------- | ---------------------------------------- |
| Dev instance       | 7690 | `k-bench-dev` | `./.data/`                               |
| Installed instance | 7680 | `k-bench`     | `~/Library/Application Support/k-bench/` |

Neither touches the other: installing never touches the Dev instance's data or socket, and `pnpm dev` and `pnpm test` never touch the Installed instance's.

### Running the Dev instance

The access guard refuses requests without the right `Tailscale-User-Login`, so run `pnpm dev` with `K_BENCH_ALLOWED_LOGIN` set. Vite's proxy then adds that header to `/api` requests, standing in for `tailscale serve`.

```sh
K_BENCH_ALLOWED_LOGIN=you@example.com pnpm dev
```

To try the Dev instance from another Device, such as a phone for the Phone layout, publish it on the tailnet:

```sh
pnpm build
K_BENCH_ALLOWED_LOGIN=you@example.com pnpm dev
pnpm dev:serve      # tailscale serve on https port 8443; --off stops it, --dry-run only prints
```

This publishes the Dev server itself (127.0.0.1:7690), not Vite, so the same login check applies and it serves the last `pnpm build`. Open `https://<your-host>.<tailnet>.ts.net:8443/`.

## Commands

```sh
pnpm dev          # the Dev instance: the server in watch mode, plus Vite on :5173, which proxies /api
pnpm dev:serve    # publish the Dev instance on the tailnet (see Running the Dev instance)
pnpm build        # production build: the front end into dist/web, the server and the `k-bench` command into dist/js
pnpm build:web    # just the front end (Vite)
pnpm build:server # just the compiled server and command (tsc -p tsconfig.build.json)
pnpm start        # the server alone, from the TypeScript source; serves dist/web when it exists
pnpm install-app  # build and install the Installed instance from this checkout; --dry-run to preview
pnpm release <version> # maintainers: open a release pull request; --dry-run to preview
pnpm smoke        # build, then probe the production server on a throwaway instance and clean up; --hold keeps it up
pnpm screenshots  # regenerate docs/images on a throwaway instance with a made-up home (not part of any test run)
pnpm screenshots:record # with screenshots:scrub, make the hero's Claude Code recording; see scripts/screenshots/hero.shots.ts
pnpm lint         # Biome (warnings fail it too)
pnpm typecheck    # tsc, for the server and tests, and for the front end (web/)
pnpm test         # Vitest: Seam 1 (the server) and Seam 3 (the packed `k-bench` command)
pnpm test:e2e     # Playwright: Seam 2 (the browser); builds the front end first
pnpm check        # lint + typecheck + test
```

## Environment variables

`K_BENCH_INSTANCE` selects an instance preset: `dev` (the default) or `installed`, with the values in [The two instances](#the-two-instances). Each of these overrides one value:

- `K_BENCH_DATA_DIR`
- `K_BENCH_TMUX_SOCKET`
- `K_BENCH_PORT`
- `K_BENCH_ALLOWED_LOGIN`: the one tailnet login let in
- `K_BENCH_PICKER_ROOT`: the folder the folder picker starts at (your home folder by default)

## Checks and CI

- Every commit runs Biome on the staged files and the typecheck (`.githooks/pre-commit`).
- `pnpm check` runs the Vitest suite, which builds and packs the package for the Seam 3 tests, so it needs the network, tmux, and `pnpm` and `npm` on PATH.
- CI (`.github/workflows/ci.yml`, macOS) runs `pnpm check` and `pnpm test:e2e` on every push to `main` and every pull request.
- OSV-Scanner (`.github/workflows/osv-scanner.yml`) checks `pnpm-lock.yaml`, dev dependencies included, against known vulnerabilities. On a pull request it fails only if the pull request introduces one compared with its base. On every push to `main`, weekly and on manual runs it scans the whole lockfile and never fails. Findings from both appear under Security → Code scanning.
- How to write tests is in [Testing](docs/testing.md), and the harnesses are in [Test seams](docs/internals/test-seams.md).

## Dependency policy

- pnpm won't resolve a release younger than 3 days (`minimumReleaseAge` in `pnpm-workspace.yaml`), which gives a compromised release time to be noticed. So `pnpm update` or `pnpm add` can skip the newest version of a package.
- The server's dependencies in `package.json` are pinned exactly. Bump one by editing its version and running `pnpm install`.
- The GitHub Actions in `.github/workflows` are pinned to commit SHAs, with the version in a trailing comment. When you bump one, look up the new tag's SHA and keep both in step.
- Dependabot (`.github/dependabot.yml`) opens a weekly pull request for each of these, also waiting 3 days after a release. A server dependency's pull request gets a CHANGELOG entry, since it changes what an owner's install resolves.
- To accept an OSV-Scanner finding you can't fix, add an ignore to `osv-scanner.toml` with a `reason` and an `ignoreUntil` no more than 90 days out, so the risk comes back up for review.

## Install from a checkout

To use your checkout as the Installed instance, or to try your changes as one:

```sh
pnpm install-app --dry-run   # prints every step and changes nothing
pnpm install-app
```

`pnpm install-app` is `k-bench install` built from your checkout: it runs `pnpm build` first, then installs exactly as the npm package does, and takes the same options. It also records the commit, and whether there were uncommitted changes, in `app/build-info.json`, and the server's startup line in the log names them. To update, `git pull` and run `pnpm install-app` again.

- The steps, the options and what to do if the HTTPS port is taken are in [Setup](docs/guide/setup.md).
- What the installer does, in order, is in [Packaging and the install](docs/internals/packaging.md).
- The install changes the real system, so it is checked by hand against [Install verification](docs/internals/install-verification.md), which also covers removing it.

## Packaging

The npm package ships compiled JavaScript and the built front end, and only the release workflow publishes it: never run `npm publish` yourself. [Packaging and the install](docs/internals/packaging.md) has the details, and [Install verification](docs/internals/install-verification.md) covers trying the packed package by hand.

## Changelog

User-visible changes get an entry under Unreleased in [CHANGELOG.md](CHANGELOG.md), in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (Added, Changed, Deprecated, Removed, Fixed, Security). Leave the released sections and the version number alone: `pnpm release` handles them.

## Releasing

Maintainers release with `pnpm release <version>` from a clean, up-to-date `main`. It opens a pull request, and merging that pull request runs the release workflow, which publishes to npm. [Releasing](docs/internals/releasing.md) has the details.

## Writing docs

Follow these rules in every doc and CHANGELOG entry:

1. **Each fact lives in one place.** Everywhere else links to it.
2. **The guide covers only what the UI doesn't show:** the model, what is kept where (on the Host or per Device), what happens on restart, logout and upgrade, and the Phone layout. Leave out what the UI already shows, such as drag thresholds, italics, breadcrumbs and button labels.
3. **Internals say who owns what, and why.** The code says how, so skip function-by-function walkthroughs.
4. **A CHANGELOG entry is at most two sentences**, in glossary terms.
5. **Capitalise every glossary term** wherever it means the k-bench concept: Rail, Extra keys, Other Session, Tab, Device, Phone layout. The browser's own tab is always a "browser tab", and a Session's earlier output is always its History.
6. **Never cite issue numbers or branch names.** They go stale. An ADR's evidence points at a merged pull request.

Where things live:

- [The guide](docs/guide/README.md): for an owner using k-bench.
- [The internals](docs/internals/README.md): how k-bench works inside.
- [GLOSSARY.md](GLOSSARY.md): the vocabulary.
- [docs/adr/](docs/adr/): the decisions, and why.
- [CHANGELOG.md](CHANGELOG.md): what changed, release by release.

## Pull requests

- Work on a branch off `main` and open a pull request against it. Issues and specs live in GitHub Issues.
- Keep the change focused, and use the glossary's terms in code, docs and commit messages.
- Run `pnpm check` and `pnpm test:e2e` before you push. CI runs both on every pull request, and a pull request needs them green.
- Add or change tests as [Testing](docs/testing.md) describes: few, outcome-level, and able to fail.
- If you change the installer or the packaging, run through [Install verification](docs/internals/install-verification.md) by hand, since automated tests cover only its pure parts and the packed command's dry run.
- Machine-local files (runtime data, logs, `.env*`, build output, editor and agent state) stay out of git. If your change introduces a new kind, update `.gitignore` in the same change.
- Never put a real hostname, tailnet name, login, email or personal path in a commit, issue, pull request or doc. Use placeholders such as `<your-host>.<tailnet>.ts.net`, `you@example.com` and `~/code/...`.
- Report security problems privately, not in a pull request or issue: see [SECURITY.md](SECURITY.md).
