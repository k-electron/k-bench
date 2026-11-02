# Troubleshooting

Start with `k-bench status`. It only looks: it never changes your Mac, your tailnet or k-bench. It runs each check, says `ok` or `FAIL` for it (with a one-line fix when it fails), prints the installed version and the URL, and exits non-zero when any check failed, so you can use it in scripts too.

```text
k-bench status

  ok    tmux is found (/opt/homebrew/bin/tmux)
  ok    the Tailscale CLI is found (/Applications/Tailscale.app/Contents/MacOS/Tailscale)
  ok    Tailscale is logged in (you@example.com)
  ok    HTTPS certificates are available (<your-host>.<tailnet>.ts.net)
  ok    the LaunchAgent is loaded (com.k-bench.server)
  ok    the server answers its health check

  version  0.1.0
  url      https://<your-host>.<tailnet>.ts.net/

All checks passed.
```

A check shows `skip` when it depends on an earlier check that failed. Fix the first `FAIL` and run it again.

| A check that fails                  | What to do                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tmux is found                       | Run `brew install tmux`.                                                                                                                                                                               |
| the Tailscale CLI is found          | Install Tailscale from [tailscale.com/download](https://tailscale.com/download). k-bench looks on your PATH and inside `/Applications/Tailscale.app`.                                                  |
| Tailscale is logged in              | Open the Tailscale app and sign in or turn it on (or run `tailscale up`).                                                                                                                              |
| HTTPS certificates are available    | Turn on HTTPS Certificates in the [Tailscale admin console](https://login.tailscale.com/admin/dns). See [Setup](setup.md#1-set-up-tailscale).                                                          |
| the LaunchAgent is loaded           | Run `k-bench install`.                                                                                                                                                                                 |
| the server answers its health check | Look in [the log](#where-the-logs-are), then run `k-bench install`. If the message says the server refused your login, see "A 403" below. If it says something else answered, see "The port is taken". |

If you report a problem, the output of `k-bench status` helps a lot. It contains your tailnet login, your machine's tailnet name and your URL, so replace those with placeholders such as `you@example.com` and `<your-host>.<tailnet>.ts.net` before you paste it anywhere public.

## A 403

k-bench admits only requests that come through `tailscale serve` carrying your own tailnet login, the one `k-bench install` recorded. Anything else is refused with a 403. Usual causes:

- **The device is signed in to Tailscale as someone else.** Sign in to the same account on that device. A person with a different login can't use your k-bench, even on the same tailnet; that is by design.
- **You changed Tailscale accounts on the Host after installing.** `k-bench status` then fails its health check with "the server is up but refused the login ...". Run `k-bench install` again to record the current login, or `k-bench install --login you@example.com` to set it yourself.
- **You opened `http://127.0.0.1:7680` on the Host itself.** That address carries no tailnet login, so it is refused. Use the tailnet URL (`k-bench status` prints it).

## Certificate errors, or the page won't open

- **HTTPS certificates aren't turned on.** The status line "HTTPS certificates are available" will say so. Follow [Setup](setup.md#1-set-up-tailscale).
- **You opened the wrong address.** The certificate is for the tailnet name in the URL that `k-bench install` printed, `https://<your-host>.<tailnet>.ts.net/`. An IP address, `localhost` or a different name gets a certificate error. If you installed with `--https-port`, the URL ends in that port.
- **The device isn't on your tailnet.** The name only resolves on devices signed in to your tailnet, with Tailscale turned on, and with MagicDNS on. Check that the Tailscale app on the device is connected.
- **It worked and now doesn't.** Run `k-bench status`: the service may have stopped, or Tailscale on the Host may be turned off.

## The port is taken

There are two ports, and the fix differs.

- **HTTPS port 443 on your tailnet name.** `k-bench install` stops, changing nothing, when `tailscale serve` already publishes something else there. Use `k-bench install --https-port 8443` to publish k-bench beside it, or `k-bench install --force` to replace it. See [If the HTTPS port is already taken](setup.md#if-the-https-port-is-already-taken). `tailscale serve status` shows what is published.
- **Port 7680 on the Host itself.** k-bench listens on `127.0.0.1` port 7680. If `k-bench status` says something answered there "but not like k-bench", another program is using that port: stop it, then run `k-bench install`.

## A Session won't start in a Missing Workspace

A Workspace is [Missing](using-k-bench.md#missing-workspaces) when its folder is gone, and no Session can start in it until the folder is fixed. Starting or restarting one shows "Folder does not exist" in the sidebar.

Open the Workspace's **...** menu, choose **Change folder** and point it at the folder's new place. Or put the folder back where it was. Sessions that were already running in it were never affected, and other Workspaces work as normal.

## Every Session says Stopped

After you log out of your Mac or restart it, that is expected: k-bench comes back on its own when you log in, everything is still listed, and you restart each Session from its **...** menu. See [Stopped Sessions](using-k-bench.md#stopped-sessions-logging-out-and-restarting). If you did neither and every Session is Stopped, tmux, which holds the shells, was stopped, so run `k-bench status` and look in [the log](#where-the-logs-are).

## A Session never shows a Bell

A Session raises a [Bell](using-k-bench.md#bells) only while nothing is viewing it, and a browser tab on any device that still has the Session open counts as viewing it. A tab left open on your laptop, or a phone that still has the Session in front, can therefore hide the Bell from you everywhere. Close the stale tab, or open a different Session in it, and Bells appear again.

If it is Claude Code that should ring, check that [the setting is on](claude-code.md#make-claude-code-ring-the-bell-when-it-is-waiting).

## Where the logs are

k-bench's log is `~/Library/Logs/k-bench/k-bench.log`. It collects everything the service prints, errors included, and the server's first line each time it starts names the version it is running. To read the end of it:

```sh
tail -n 100 ~/Library/Logs/k-bench/k-bench.log
```

`k-bench uninstall` keeps the log, and `k-bench uninstall --purge` deletes it. Your data, the database of Workspaces and Sessions, is in `~/Library/Application Support/k-bench/`.

## Still stuck?

[Open an issue](https://github.com/k-electron/k-bench/issues/new/choose) and include the output of `k-bench status`, the relevant lines of the log, your macOS and Node versions, and what you did, with placeholders in place of your login and tailnet name. If you think someone other than you can get into your k-bench, do not post it publicly: see [SECURITY.md](../../SECURITY.md).
