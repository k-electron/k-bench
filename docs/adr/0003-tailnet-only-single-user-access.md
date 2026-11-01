# Access is limited to the owner's tailnet login; no app-level password

k-bench is a remote shell on the Host, so reaching it means being able to run anything as the owner. Access has four layers and no password:

1. The server listens only on `127.0.0.1`.
2. `tailscale serve` is the only way in, and it provides HTTPS on the tailnet name.
3. The server rejects any request whose `Tailscale-User-Login` header (added by `tailscale serve`) isn't the owner's login.
4. The server rejects any request or WebSocket upgrade whose `Origin` header names a host other than the one the request was sent to.

Being on the tailnet is not enough on its own: shared nodes and other tailnet users must not get in.

## Why layer 4 is required

`tailscale serve` adds the owner's login to every request coming from the owner's devices, whichever web page made it. Without layer 4, any site the owner visits could open a terminal WebSocket to k-bench and get a shell on the Host. Browsers can't hide or forge `Origin`, so checking it limits k-bench to pages k-bench served. Requests without an `Origin` (curl, scripts on the owner's devices) still pass layers 1–3. This layer was missed in the original design and added during the v1 code review. It is covered by the server's origin tests, and must not be dropped as redundant with layer 3.
