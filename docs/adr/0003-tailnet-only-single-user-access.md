# Access is limited to the owner's tailnet login; no app-level password

k-bench is a remote shell on the Host, so reaching it means being able to run anything as the owner. Access has three layers and no password:

1. The server listens only on `127.0.0.1`.
2. `tailscale serve` is the only way in, and it provides HTTPS on the tailnet name.
3. The server rejects any request whose `Tailscale-User-Login` header (added by `tailscale serve`) isn't the owner's login.

Being on the tailnet is not enough on its own: shared nodes and other tailnet users must not get in.
