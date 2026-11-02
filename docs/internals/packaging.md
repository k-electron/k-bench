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
- `tsconfig.build.json` extends `tsconfig.json` with emit turned on. It compiles `src/server`, `src/shared` and the command (`scripts/k-bench.ts`, `scripts/install.ts`, `scripts/install-lib.ts`). The root `tsconfig.json` has `rewriteRelativeImportExtensions`, so `./x.ts` imports are emitted as `./x.js`. Because the root is `.`, the output mirrors the source: `dist/js/src/server/main.js`, `dist/js/scripts/k-bench.js`.
- `prepack` runs `pnpm build`, so `npm pack` and `npm publish` cannot ship a stale or missing build.
- `dist/` is gitignored, and so are the `*.tgz` files `npm pack` writes.

## `k-bench install`

`scripts/k-bench.ts` is the command (`install`, `--help`, `--version`); `scripts/install.ts` is the installer and `scripts/install-lib.ts` holds its pure, unit-tested parts. From a checkout, `pnpm install-app` runs `node scripts/k-bench.ts install`.

The installer looks for its files in the package folder (the nearest folder with a `package.json` above the script). It is running from a checkout, not the npm package, when `src/server/main.ts` exists there; the package ships only compiled JavaScript. In order:

1. Checkout only: `pnpm build`.
2. Copy `dist/js/src`, `dist/web` and `scripts/fix-node-pty.mjs` into `app.staging` beside the database, with a generated `package.json` (name, version, `engines` and `dependencies` only, so installing runs none of the package's own scripts).
3. Write `build-info.json` there: the package `version` and `installedAt`, plus `commit` and `dirty` from git when installing from a checkout. The server reads it, and its startup line names the version and, from a checkout, the commit.
4. `npm install --omit=dev` in the staging folder, then the spawn-helper fix and check. This is the only step that needs the network. It resolves the version ranges in `package.json`, as an owner's `npm i -g` does; there is no lockfile in the installed app.
5. Stop the LaunchAgent, swap `app.staging` in as `app` (two renames), write the plist, load it, wait until the server answers 403 on `127.0.0.1`, then `tailscale serve --bg --https=443`.

The installer copies the app out of the package instead of running it in place: `npm i -g` replaces the package's folder, which would swap files under a running server. The LaunchAgent runs `app/dist/js/src/server/main.js` with the app folder as its working directory, which is where the server finds `dist/web` and `build-info.json`. Stopping the agent leaves tmux, and so every Session, running (ADR 0001).

## Testing it

`pnpm test` builds and packs the real package and runs the `k-bench` command from a temp prefix with stub programs on PATH: see [Test seams](test-seams.md#seam-3-the-packed-k-bench-command). The real install changes the Host, so it stays on the [manual checklist](install-verification.md).
