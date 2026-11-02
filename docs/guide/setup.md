# Setup

This page takes you from nothing to a running k-bench, and then covers updating and uninstalling it. k-bench works on macOS only, and Tailscale is the only way to reach it.

You need:

- A Mac, which k-bench calls the Host.
- Node 26 or later. Check with `node --version`.
- tmux: `brew install tmux`.
- Tailscale on the Host, and on every device you will browse from, all signed in to the same tailnet.

## 1. Set up Tailscale

k-bench is published on your tailnet with `tailscale serve`, which serves it over HTTPS. That needs HTTPS certificates turned on for your tailnet, and it is the one step people most often miss.

1. Install Tailscale on the Host from [tailscale.com/download](https://tailscale.com/download) and sign in. Do the same on your phone and any other device you want to use k-bench from, with the same account.
2. Open the [DNS page of the Tailscale admin console](https://login.tailscale.com/admin/dns). You need to be an admin of your tailnet to change it.
3. Turn on MagicDNS, if it is not on already.
4. Under **HTTPS Certificates**, choose **Enable HTTPS**, and acknowledge the notice that your machine names and your tailnet's DNS name will be published on a public ledger (Certificate Transparency, where every public TLS certificate is recorded).

Tailscale's own page, [Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https), describes these steps and the ledger. You do not need to request a certificate yourself: `tailscale serve` takes care of that. [Tailscale Serve](https://tailscale.com/kb/1312/serve) describes the feature k-bench uses.

k-bench finds the Tailscale command-line tool on its own, either on your PATH or inside `/Applications/Tailscale.app`. If it can't, the install tells you so.

You can check this step at any time with `k-bench status`: its "HTTPS certificates are available" line passes once it is done.

## 2. Install k-bench

```sh
npm i -g @k-electron/k-bench
k-bench install
```

The install:

- checks that tmux and the Tailscale CLI are there, and stops with a message saying what to fix if either is missing;
- reads your tailnet login from Tailscale and records it as the only login allowed in (`--login you@example.com` sets it yourself);
- copies k-bench into `~/Library/Application Support/k-bench/app/` and installs its dependencies there, which needs the network (node-pty ships prebuilt binaries, so there is no compiler or Xcode step);
- writes a LaunchAgent, `~/Library/LaunchAgents/com.k-bench.server.plist`, so k-bench starts every time you log in and restarts if it crashes, and loads it;
- publishes k-bench with `tailscale serve` on HTTPS port 443;
- prints the URL, which looks like `https://<your-host>.<tailnet>.ts.net/`.

Open that URL from any device on your tailnet, signed in with the same login. Your data lives in `~/Library/Application Support/k-bench/`, and k-bench's log is `~/Library/Logs/k-bench/k-bench.log`.

To see every step before anything happens, run:

```sh
k-bench install --dry-run
```

A dry run prints each step with `would:` in front and changes nothing. It still checks tmux, Tailscale and the HTTPS port, so it also warns you about the port conflict below.

Then run `k-bench status`: it should say `All checks passed.`

### If the HTTPS port is already taken

If something else is already published by `tailscale serve` on port 443, `k-bench install` stops before it changes anything and says:

```text
k-bench install: HTTPS port 443 already serves something other than k-bench:
  ...what is there...
Nothing was changed. Publish k-bench on another port with `--https-port <n>` (for example `--https-port 8443`), or replace what is on port 443 with `--force`.
```

Your options:

- **Keep both.** Publish k-bench on another HTTPS port:

  ```sh
  k-bench install --https-port 8443
  ```

  The URL it prints then ends with the port, for example `https://<your-host>.<tailnet>.ts.net:8443/`. Use `tailscale serve status` to see what is published today.
- **Replace the other service.** `k-bench install --force` removes whatever is on the port, then publishes k-bench there. Do this only when you mean it: the other service stops being published.

Running `k-bench install` again over k-bench's own earlier install is not a conflict and needs neither flag.

### The options

| Command                               | What it does                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `k-bench install`                     | Install or update k-bench and publish it on HTTPS port 443.                             |
| `k-bench install --dry-run`           | Show every step and change nothing.                                                     |
| `k-bench install --login <login>`     | Use this tailnet login instead of reading yours from Tailscale.                         |
| `k-bench install --https-port <n>`    | Publish on HTTPS port `n` instead of 443.                                               |
| `k-bench install --force`             | Replace whatever else is published on that port.                                        |
| `k-bench status`                      | Check that everything is set up and healthy. See [Troubleshooting](troubleshooting.md). |
| `k-bench uninstall`                   | Remove the service. See below.                                                          |
| `k-bench --version`, `k-bench --help` | Print the version of the npm package, or the usage.                                     |

## 3. Updating

Updating is two commands:

```sh
npm i -g @k-electron/k-bench
k-bench install
```

The first upgrades the npm package, and the second installs it as the running service. Every Session keeps running through an update, and browser tabs you have open reconnect on their own, so there is nothing to reload. `k-bench status` shows the installed version. Read the [CHANGELOG](../../CHANGELOG.md) to see what changed.

Upgrading the npm package alone does not change what is running: k-bench keeps serving the copy it installed until you run `k-bench install`.

## 4. Uninstalling

```sh
k-bench uninstall --dry-run   # shows what it would do, changes nothing
k-bench uninstall
```

`k-bench uninstall` stops the service, removes it from your login items (the LaunchAgent), removes k-bench's own `tailscale serve` entry, and deletes the installed app folder. It leaves your other `tailscale serve` entries alone.

It keeps your data. Every Workspace and Session is still listed in the database, Sessions that are running carry on in the background until you end them or restart the Mac, and the logs stay. Run `k-bench install` again and k-bench is back as it was.

To remove everything, including your data:

```sh
k-bench uninstall --purge
```

`--purge` also deletes the database and the logs, and ends every Session. That cannot be undone, and anything running in a Session stops. Use `--dry-run` with it first if you want to see what it would delete.

Neither form removes the `k-bench` command itself. For that, run `npm uninstall -g @k-electron/k-bench`.

Next: [Using k-bench](using-k-bench.md).
