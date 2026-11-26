# Troubleshooting

Start with `k-bench status`. It only looks: it never changes your Mac, your tailnet or k-bench. Fix the first of [its checks](../internals/packaging.md#k-bench-status) that says `FAIL`, using the fix it prints or the table below, then run it again; a check that depends on a failed one says `skip` until then.

| A check that fails                  | What to do                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tmux is found                       | Run `brew install tmux`.                                                                                                                                                                               |
| the Tailscale CLI is found          | Install Tailscale from [tailscale.com/download](https://tailscale.com/download). k-bench looks on your PATH and inside `/Applications/Tailscale.app`.                                                  |
| Tailscale is logged in              | Open the Tailscale app and sign in or turn it on (or run `tailscale up`).                                                                                                                              |
| HTTPS certificates are available    | Turn on HTTPS Certificates in the [Tailscale admin console](https://login.tailscale.com/admin/dns). See [Setup](setup.md#1-set-up-tailscale).                                                          |
| the LaunchAgent is loaded           | Run `k-bench install`.                                                                                                                                                                                 |
| the server answers its health check | Look in [the log](#where-the-logs-are), then run `k-bench install`. If the message says the server refused your login, see "A 403" below. If it says something else answered, see "The port is taken". |

If you report a problem, the output of `k-bench status` helps a lot. It contains your tailnet login, your Mac's tailnet name and your URL, so replace those with placeholders such as `you@example.com` and `<your-host>.<tailnet>.ts.net` before you paste it anywhere public.

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

- **HTTPS port 443 on your tailnet name.** `k-bench install` stops, changing nothing, when `tailscale serve` already publishes something else there. See [If the HTTPS port is already taken](setup.md#if-the-https-port-is-already-taken).
- **Port 7680 on the Host itself.** k-bench listens on `127.0.0.1` port 7680. If `k-bench status` says something answered there "but not like k-bench", another program is using that port: stop it, then run `k-bench install`.

## A Session won't start in a Missing Workspace

Starting or restarting a Session says "Folder does not exist" when its Workspace is [Missing](using-k-bench.md#missing): its folder was moved, renamed or deleted. [Missing](using-k-bench.md#missing) says how to fix it.

## Every Session says Stopped

After you log out of your Mac or restart it, that is expected: see [Stopped Sessions](using-k-bench.md#stopped-sessions). If you did neither and every Session is Stopped, tmux, which holds the Sessions' programs, was stopped, so run `k-bench status` and look in [the log](#where-the-logs-are).

## A Session never shows a Bell

A Session raises a [Bell](using-k-bench.md#bells) only while nothing is viewing it, and a browser tab on any Device that still shows the Session counts as viewing it. A browser tab left open on your laptop, or a phone that still has the Session on screen, therefore hides its Bell from you everywhere. Close that browser tab, or show a different Session in it, and Bells appear again.

If it is Claude Code that should ring, check that [the setting is on](claude-code.md#make-claude-code-ring-the-bell-when-it-is-waiting).

## Where the logs are

k-bench's log is `~/Library/Logs/k-bench/k-bench.log`. It collects everything the service prints, errors included, and the server's first line each time it starts names the version it is running. To read the end of it:

```sh
tail -n 100 ~/Library/Logs/k-bench/k-bench.log
```

`k-bench uninstall` keeps the log, and `k-bench uninstall --purge` deletes it. Your data, the database of Workspaces and Sessions, is in `~/Library/Application Support/k-bench/`.

## Still stuck?

[Open an issue](https://github.com/k-electron/k-bench/issues/new/choose) and include the output of `k-bench status`, the relevant lines of the log, your macOS and Node versions, and what you did, with placeholders in place of your login and tailnet name. If you think someone other than you can get into your k-bench, do not post it publicly: see [SECURITY.md](../../SECURITY.md).
