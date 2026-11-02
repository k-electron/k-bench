# Install verification

The install changes the real system, so it is checked by hand, not by automated tests (only its pure parts are unit-tested in `test/install.test.ts`). How to install is in [CONTRIBUTING](../../CONTRIBUTING.md#install-from-a-checkout).

## Checklist

Create a couple of Sessions first, then:

1. After `pnpm install-app`, k-bench opens at the tailnet HTTPS URL from your phone.
2. A request from another tailnet identity, or with no Tailscale identity, is refused with 403 (for example `curl http://127.0.0.1:7680/api/state` on the Host, which sends no identity).
3. `launchctl kickstart -k gui/$(id -u)/com.k-bench.server` restarts k-bench and every Session is still running.
4. Run `pnpm install-app` again: every Session is still running.
5. Log out and in again: k-bench comes back on its own, with every Workspace and Session still listed, and the Sessions show Stopped (logging out of the Host ends their shells). One click restarts each. Rebooting the Host gives the same result.
6. `pnpm dev:serve` publishes the Dev instance on port 8443 and the same login check refuses other identities.
7. Throughout, the Dev instance's `./.data/` and `k-bench-dev` socket are untouched by the install, and the Installed instance's data and `k-bench` socket are untouched by `pnpm dev` and `pnpm test`.

## Removing the install

To remove the install: `launchctl bootout gui/$(id -u)/com.k-bench.server`, delete the plist (`~/Library/LaunchAgents/com.k-bench.server.plist`), `tailscale serve --https=443 off`, and delete `~/Library/Application Support/k-bench/app` (the database and tmux sessions stay).
