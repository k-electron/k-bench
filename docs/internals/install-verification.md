# Install verification

The install changes the real system, so it is checked by hand, not by automated tests (only its pure parts are unit-tested in `test/install.test.ts`, and the packed command's dry run in `test/packed-command.test.ts`). How to install is in [CONTRIBUTING](../../CONTRIBUTING.md#install-from-a-checkout); how the install works is in [Packaging](packaging.md).

## Checklist

Create a couple of Sessions first, then:

1. After `pnpm install-app`, k-bench opens at the tailnet HTTPS URL from your phone.
2. A request from another tailnet identity, or with no Tailscale identity, is refused with 403 (for example `curl http://127.0.0.1:7680/api/state` on the Host, which sends no identity).
3. `launchctl kickstart -k gui/$(id -u)/com.k-bench.server` restarts k-bench and every Session is still running.
4. Run `pnpm install-app` again: every Session is still running.
5. Log out and in again: k-bench comes back on its own, with every Workspace and Session still listed, and the Sessions show Stopped (logging out of the Host ends their shells). One click restarts each. Rebooting the Host gives the same result.
6. `pnpm dev:serve` publishes the Dev instance on port 8443 and the same login check refuses other identities.
7. Throughout, the Dev instance's `./.data/` and `k-bench-dev` socket are untouched by the install, and the Installed instance's data and `k-bench` socket are untouched by `pnpm dev` and `pnpm test`.
8. Every install ends by printing the URL, and opening it works. On port 443 the URL has no port; after `--https-port 8443` it ends `:8443/`.
9. `k-bench status` after an install: every check shows `ok`, the exit status is 0, and it prints the installed version (the one in `app/build-info.json`) and the same URL the install printed. Then break one thing at a time and check that the matching line shows `FAIL` with a fix and the exit status is non-zero: `launchctl bootout gui/$(id -u)/com.k-bench.server` (LaunchAgent not loaded, server not answering; `k-bench install` brings it back), and a tmux missing from PATH (`PATH=/usr/bin:/bin k-bench status`, if tmux lives elsewhere). The Tailscale checks can only be seen failing with Tailscale logged out or turned off, so do that on a Host where you can afford it.

### Port conflicts

Use `tailscale serve status` to look before and after each item. These touch your real `tailscale serve` setup, so only do them on a Host where you can afford to lose and recreate a throwaway entry (for example `tailscale serve --bg --https=8443 http://127.0.0.1:3000`, removed afterwards with `tailscale serve --https=8443 off`).

1. With a throwaway entry on port 8443, `k-bench install --dry-run --https-port 8443` exits with an error naming `--https-port` and `--force`, and `tailscale serve status` is unchanged. Without `--dry-run` the same holds, and nothing else (app folder, LaunchAgent) changes either.
2. `k-bench install --https-port 8443 --force` replaces the throwaway entry: `tailscale serve status` shows k-bench there and the URL printed ends `:8443/`.
3. Running `k-bench install --https-port 8443` again, with k-bench's own entry already there, proceeds without `--force` and leaves the same entry.
4. If something else serves port 443, plain `k-bench install` stops and leaves it alone; `k-bench install --https-port 8443` publishes k-bench beside it and the 443 service still works.
5. `--force` on a port serving a TCP forward (`tailscale serve --bg --tcp=5432 tcp://localhost:5432`) removes it and publishes k-bench there. This is the one item that depends on `tailscale serve --tcp=<port> off`, which the unit tests cannot confirm.

## Installing from the packed package

The checklist above holds for both routes. Check the npm route too whenever packaging or the installer changes:

1. `pnpm build && npm pack`, then `npm install --global ./k-electron-k-bench-<version>.tgz` (this replaces any earlier global k-bench package; use `--prefix <tmp>` to keep it away from your real one, and then run `<tmp>/bin/k-bench`).
2. `k-bench install --dry-run` lists every step and changes nothing; it does not offer to build.
3. With Sessions running, `k-bench install`: every Session is still running, `app/build-info.json` has the package `version` and no `commit`, and the first line the server logs in `~/Library/Logs/k-bench/k-bench.log` names that version.
4. `pnpm install-app` from a checkout still works: `build-info.json` has the `version` and the `commit`, and the startup line names both.
5. Run `npm install --global` of a different build over the first one: the running server keeps serving from `app/` until the next `k-bench install`.

## Removing the install

To remove the install: `launchctl bootout gui/$(id -u)/com.k-bench.server`, delete the plist (`~/Library/LaunchAgents/com.k-bench.server.plist`), `tailscale serve --https=443 off` (use the port you installed on; `tailscale serve status` shows which entry proxies to `127.0.0.1:7680`), and delete `~/Library/Application Support/k-bench/app` (the database and tmux sessions stay).
