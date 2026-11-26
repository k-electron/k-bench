# Packaging and the install

k-bench is published to npm as `@k-electron/k-bench`. An owner runs `npm i -g @k-electron/k-bench`, then `k-bench install`, and gets the same Installed instance that `pnpm install-app` makes from a checkout. This page is the one home of how the install and uninstall work.

## What the package is

- `package.json` has `os: darwin`, `engines.node >= 26`, and `bin.k-bench` pointing at `dist/js/scripts/k-bench.js`. Its `version` is the last release's; only `pnpm release` changes it, and only the release workflow publishes (see [Releasing](releasing.md)).
- `files` is an allow-list: `dist/js` (the compiled command and server), `dist/web` (the built front end) and `scripts/fix-node-pty.mjs`. The TypeScript source, tests, docs and lockfile don't ship.
- `dependencies` holds only what the server runs on, pinned to exact versions: there is no lockfile in the installed app, so pinning makes the Host run what CI tested. Their own dependencies still resolve on install. The front end is bundled by Vite, so its libraries are `devDependencies` and are never installed on the Host.
- node-pty ships prebuilt darwin binaries, so installing needs no compiler. pnpm drops the execute bit from its `spawn-helper`, so `scripts/fix-node-pty.mjs` restores it: the package's `postinstall` runs it, and the installer runs it again and checks the bit.

## The build

Node does not strip TypeScript types from files under `node_modules`, so the package ships compiled JavaScript.

- `pnpm build` is `pnpm build:web` (Vite, into `dist/web`) then `pnpm build:server` (`tsc -p tsconfig.build.json`, into a fresh `dist/js`).
- `tsconfig.build.json` compiles `src/server`, `src/shared` and the command's scripts, and lists them. `rewriteRelativeImportExtensions` turns `./x.ts` imports into `./x.js`, and the output mirrors the source: `dist/js/src/server/main.js`, `dist/js/scripts/k-bench.js`.
- `prepack` runs `pnpm build`, so `npm pack` and `npm publish` can't ship a stale or missing build.

## `k-bench install`

The installer finds its files in the package folder, the nearest folder with a `package.json` above the script. It is running from a checkout when `src/server/main.ts` exists there. Before anything else, a dry run included, it fails when the running Node is older than `engines.node`, which npm only warns about. Then it checks tmux and Tailscale and reads the serve configuration: if the chosen HTTPS port (443, or `--https-port`) serves anything other than k-bench's own entry, it stops without changing anything, naming `--https-port` and `--force`. Then, in order:

1. From a checkout only: `pnpm build`.
2. Copy `dist/js/src`, `dist/web` and `scripts/fix-node-pty.mjs` into `app.staging` beside the database, with a generated `package.json` holding only the name, version, `engines` and `dependencies`, so installing runs none of the package's own scripts.
3. Write `build-info.json` there: the `version` and `installedAt`, plus `commit` and `dirty` from git when installing from a checkout. The server's startup line names the version and, from a checkout, the commit.
4. `npm install --omit=dev` in the staging folder, then the `spawn-helper` fix and check. This is the only step that needs the network.
5. Stop the LaunchAgent, swap `app.staging` in as `app` (two renames), write the plist, load it, and wait until the server answers 403 on `127.0.0.1`.
6. Publish with `tailscale serve --bg --https=<port>`. With `--force` over someone else's entry, that entry is switched off first.

It ends by printing the URL: `https://<your-host>.<tailnet>.ts.net/`, with `:<port>` when the port isn't 443.

The installer copies the app out of the package instead of running it in place, because `npm i -g` replaces the package's folder, which would swap files under a running server. The LaunchAgent runs `app/dist/js/src/server/main.js` with the app folder as its working directory, where the server finds `dist/web` and `build-info.json`. Stopping the agent leaves tmux, and so every Session, running ([ADR 0001](../adr/0001-tmux-owns-the-terminals.md)).

## `k-bench uninstall`

`k-bench uninstall [--dry-run] [--purge]` reverses the install. Each step announces itself, prefixed `would:` in a dry run, or says there is nothing to remove:

1. Boot out the LaunchAgent if it is loaded (tmux, and so every Session, keeps running), then delete its plist.
2. Switch off every `tailscale serve` entry that is k-bench's own, on every port it is published on. Other entries are left alone and named. Without the Tailscale CLI the step is skipped with a note. If reading or removing fails, the command carries on, says what was not removed and exits non-zero.
3. Delete the app folder, and any `app.staging` or `app.previous` an interrupted install left. The database beside it stays.
4. With `--purge` only: end the `k-bench` tmux server (ending every Session), delete the data folder and delete `~/Library/Logs/k-bench`.

It ends by listing what it kept or, with `--purge`, by saying nothing was kept and that `npm uninstall -g @k-electron/k-bench` removes the command itself. A dry run only reads, so it also works when nothing is installed.

## `k-bench status`

A read-only health check of the Installed instance. It prints each check as `ok`, `skip` (a check it depends on failed) or `FAIL` with a one-line `fix:`, then the installed version and the URL, and exits non-zero when any check failed.

- The checks, in order: tmux is on PATH; the Tailscale CLI is found (on PATH, else inside Tailscale.app); Tailscale is logged in; HTTPS certificates are available; the LaunchAgent is loaded; the server answers its health check.
- The health check is `GET /api/health` on `127.0.0.1:7680`. It sits behind the access guard like the rest of the API, so status sends the logged-in Tailscale user's login, as `tailscale serve` would. A server that refuses that login is a failure with its own fix: the allowed login is out of date, and `k-bench install` sets it again.
- The version comes from the installed `app/build-info.json` ("not installed" without one). The URL comes from k-bench's own serve entry ("not published" without one). Neither is a check.

## Rules all three commands share

- They always target the Installed instance and ignore any `K_BENCH_*` override in the environment. The one exception is `K_BENCH_STATUS_PORT`, which the packed-command tests use to point status at a throwaway server.
- k-bench's own `tailscale serve` entry is a web entry whose only handler is `/`, proxying to `http://127.0.0.1:7680`. An entry that shares its port with other paths is not k-bench's, and nor is the Dev instance's (`pnpm dev:serve`, which proxies to port 7690). `scripts/tailscale-serve.ts` owns this rule.

## Testing it

The packed command is tested by running it against stub programs: see [Test seams](test-seams.md#seam-3-the-packed-k-bench-command-vitest). The real install changes the Host, so it is checked by hand: see [Install verification](install-verification.md).
