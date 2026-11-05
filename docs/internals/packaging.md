# Packaging and the install

k-bench is published to npm as `@k-electron/k-bench`. An owner runs `npm i -g @k-electron/k-bench`, then `k-bench install`, and gets the same Installed instance that `pnpm install-app` makes from a checkout. This page is how that is put together.

## What the package is

- `package.json` has the scoped name, the MIT license, repository and homepage links, `os: darwin`, `engines.node >= 26`, and `bin.k-bench` pointing at `dist/js/scripts/k-bench.js`.
- The version in the checkout stays at `0.0.0` until a release bumps it. Only the release workflow publishes; never run `npm publish` by hand (see [Releasing](releasing.md), which also covers the owner's one-off placeholder publish).
- `files` is an allow-list: `dist/js` (the compiled command and server), `dist/web` (the built front end) and `scripts/fix-node-pty.mjs`. Nothing else ships: not the TypeScript source, tests, docs or the lockfile.
- `dependencies` holds only what the server runs on (`hono`, `@hono/node-server`, `ws`, `node-pty`). The front end is bundled by Vite, so its libraries (React, xterm.js, Radix and so on) are `devDependencies`: they are not installed on the Host.
- node-pty ships prebuilt darwin binaries, so installing needs no compiler or Xcode. `scripts/fix-node-pty.mjs` restores its `spawn-helper` execute bit (pnpm drops it); the package's `postinstall` runs it, and the installer runs it again and checks the bit (`nodePtyProblems`).

## The build

Node does not strip TypeScript types from files under `node_modules`, so the package ships compiled JavaScript.

- `pnpm build` is `pnpm build:web` (Vite, into `dist/web`) then `pnpm build:server` (`tsc -p tsconfig.build.json`, into `dist/js`, after deleting the old `dist/js`).
- `tsconfig.build.json` extends `tsconfig.json` with emit turned on. It compiles `src/server`, `src/shared` and the command (`scripts/k-bench.ts`, `scripts/install.ts`, `scripts/install-lib.ts`, `scripts/command-lib.ts`, `scripts/uninstall.ts`, `scripts/status.ts`, `scripts/tailscale-serve.ts`). The root `tsconfig.json` has `rewriteRelativeImportExtensions`, so `./x.ts` imports are emitted as `./x.js`. Because the root is `.`, the output mirrors the source: `dist/js/src/server/main.js`, `dist/js/scripts/k-bench.js`.
- `prepack` runs `pnpm build`, so `npm pack` and `npm publish` cannot ship a stale or missing build.
- `dist/` is gitignored, and so are the `*.tgz` files `npm pack` writes.

## `k-bench install`

`scripts/k-bench.ts` is the command (`install`, `uninstall`, `status`, `--help`, `--version`); `scripts/install.ts` is the installer and `scripts/install-lib.ts` holds its pure, unit-tested parts. `scripts/command-lib.ts` is what `install`, `uninstall` and `status` share: the LaunchAgent label, where the plist, log and `build-info.json` live, the PATH and `launchctl` helpers and the `say`/`step` reporting. From a checkout, `pnpm install-app` runs `node scripts/k-bench.ts install`.

The installer looks for its files in the package folder (the nearest folder with a `package.json` above the script). It is running from a checkout, not the npm package, when `src/server/main.ts` exists there; the package ships only compiled JavaScript. Before anything else, a dry run too, it fails clearly when the running Node is older than the package's `engines.node` (npm only warns about that). In order:

1. Checkout only: `pnpm build`.
2. Copy `dist/js/src`, `dist/web` and `scripts/fix-node-pty.mjs` into `app.staging` beside the database, with a generated `package.json` (name, version, `engines` and `dependencies` only, so installing runs none of the package's own scripts).
3. Write `build-info.json` there: the package `version` and `installedAt`, plus `commit` and `dirty` from git when installing from a checkout. The server reads it, and its startup line names the version and, from a checkout, the commit.
4. `npm install --omit=dev` in the staging folder, then the spawn-helper fix and check. This is the only step that needs the network. There is no lockfile in the installed app, so the server's dependencies (`hono`, `@hono/node-server`, `ws` and `node-pty`) are pinned to exact versions in `package.json`: the Host runs what CI tested, not whatever a range resolves to on the day of install, as with an owner's `npm i -g`. Their own dependencies still resolve on install; today that is `node-pty`'s `node-addon-api` and nothing else.
5. Stop the LaunchAgent, swap `app.staging` in as `app` (two renames), write the plist, load it, wait until the server answers 403 on `127.0.0.1`, then publish with `tailscale serve --bg --https=<port>` (443 unless `--https-port`). With `--force` over someone else's entry, `tailscale serve --https=<port> off` (`--tcp=<port>` for a raw TCP forward) runs first.

Before any of that, right after the tmux and Tailscale checks, the installer reads the serve configuration (below). If the chosen port serves anything other than k-bench's own entry and there is no `--force`, it exits with an error that names `--https-port` and `--force`, having changed nothing; a dry run checks too. The install ends by printing the URL, `https://<host>/` or `https://<host>:<port>/` (a dry run says where k-bench would be reachable).

## Uninstall

`scripts/uninstall.ts` (`k-bench uninstall [--dry-run] [--purge]`) reverses the install without the owner needing to know how it was done. In order, each step announcing itself (prefixed `would:` in a dry run) or saying there is nothing to remove:

1. `launchctl bootout` the LaunchAgent if it is loaded (stopping it leaves tmux, and so every Session, running), then delete its plist.
2. Read the serve configuration and switch off every entry `findOwnEntries(config, 7680)` finds (k-bench's, on each port it is published on: a reinstall on another `--https-port` leaves the earlier one) with `serveOffArgs`. Other entries are left alone and named. If the Tailscale CLI is missing the step is skipped with a note; if reading or removing fails, the command carries on, says what was not removed and exits non-zero.
3. Delete the app folder (and any `app.staging` / `app.previous` left by an interrupted install). The database beside it stays.
4. With `--purge` only: end the `k-bench` tmux server (`tmux -L k-bench kill-server`, ending every Session), delete the data folder and delete `~/Library/Logs/k-bench`.

It ends by listing what it kept (the data folder, the running Sessions, the logs), or, with `--purge`, by saying nothing was kept and that `npm uninstall -g @k-electron/k-bench` removes the command itself. A dry run does the read-only checks (`launchctl print`, `tailscale serve status --json`, `tmux list-sessions`, which paths exist) and changes nothing; it therefore works, and says so, when nothing is installed. Like the install, it always targets the Installed instance and ignores any `K_BENCH_*` override in the environment.

## `k-bench status`

`scripts/status.ts` is a read-only health check of the Installed instance: it never changes the machine, the tailnet or the app. It prints each check as `ok`, `skip` (needs a check that failed before it) or `FAIL` with a one-line `fix:`, then the installed version and the URL, and exits non-zero when any check failed.

- Checks, in order: tmux is on PATH; the Tailscale CLI is found (PATH, else inside Tailscale.app); Tailscale is logged in (`tailscale status --json` has `BackendState: "Running"`); HTTPS certificates are available (`CertDomains` is not empty); the LaunchAgent `com.k-bench.server` is loaded (`launchctl print` succeeds); the server answers its health check.
- The health check is `GET /api/health` on `127.0.0.1:7680`, which answers `{"status":"ok"}`. It sits behind the access guard like the rest of the API (ADR 0003 is unchanged: no unauthenticated route was added), so status sends the logged-in Tailscale user's login in `Tailscale-User-Login`, as `tailscale serve` would. A server that is up but refuses that login is therefore a failure with its own fix: the allowed login is out of date, and `k-bench install` sets it again.
- The version is `version` (and `commit`, from a checkout) from the installed app's `app/build-info.json`; it is "not installed" when there is none. The URL is `serveUrl` for the port of `findOwnEntry` in the serve configuration (see below), or "not published" with a fix when k-bench has no entry. These two lines are information, not checks.
- Like the installer, status ignores `K_BENCH_*` variables from the shell and describes the Installed instance. The one exception, `K_BENCH_STATUS_PORT`, exists for the packed-command tests: it points the health check and the lookup of k-bench's own serve entry at a throwaway server instead of port 7680.

## The tailscale serve configuration

`scripts/tailscale-serve.ts` reads `tailscale serve status --json` and is shared by the `k-bench` commands: `install` uses it to protect other setups, and `uninstall` and `status` build on it (`status` uses `findOwnEntry` and `serveUrl`). Its parsing is pure and is tested through the packed command, with stub serve configurations; `readServeConfig(tailscale)` is the only call that runs the CLI.

- The JSON is a `Web` map keyed `<host>:<port>` (each with `Handlers` by URL path: `Proxy`, `Path`, `Text` or `Redirect`) and a `TCP` map by port (`{ "HTTPS": true }` for a web listener, `{ "TCPForward": "host:port" }` for a raw forward). `{}` means nothing is served.
- `parseServeConfig` turns that into entries, one per port. `findOwnEntries(config, localPort)` finds k-bench's own entries (`findOwnEntry` is the first), on whichever ports: a web entry whose only handler is `/` proxying to `http://127.0.0.1:<localPort>` (7680 for the Installed instance; the Dev instance's `pnpm dev:serve` entry, proxying to 7690, is therefore not k-bench's own). An entry that shares its port with other paths is not. `portUse(config, port, localPort)` says whether a port is free, k-bench's own or something else (judged by what is on that port, not by whichever k-bench entry comes first), and `serveUrl(dnsName, port)` builds the URL (no `:port` for `DEFAULT_HTTPS_PORT`, 443).
- `serveOffArgs(entry)` gives the arguments that switch an entry off, for `--force` and for uninstall.

The installer copies the app out of the package instead of running it in place: `npm i -g` replaces the package's folder, which would swap files under a running server. The LaunchAgent runs `app/dist/js/src/server/main.js` with the app folder as its working directory, which is where the server finds `dist/web` and `build-info.json`. Stopping the agent leaves tmux, and so every Session, running (ADR 0001).

## Testing it

`pnpm test` builds and packs the real package and runs the `k-bench` command from a temp prefix with stub programs on PATH: see [Test seams](test-seams.md#seam-3-the-packed-k-bench-command). The real install changes the Host, so it stays on the [manual checklist](install-verification.md).
