# Access

The design decision is [ADR 0003](../adr/0003-tailnet-only-single-user-access.md): tailnet-only, single-user access. This is how it is enforced.

Every HTTP request and WebSocket upgrade must carry `Tailscale-User-Login` equal to `K_BENCH_ALLOWED_LOGIN`, otherwise it gets 403. With no login configured, everything is refused. The server listens on `127.0.0.1` only.

A request that carries an `Origin` header must name the same host as its `Host` header, otherwise it gets 403. `tailscale serve` adds the owner's login to anything their browser sends, so without this a web page on another site could open the terminal WebSocket and run commands. Behind `tailscale serve`, `Host` and `Origin` are both the tailnet name; behind the Vite dev proxy both are `localhost:5173`; clients that send no `Origin` (curl, tests, the install health check) are unaffected. A request body must be declared `application/json` (415 otherwise).

The check lives in `src/server/access-guard.ts`. To run the Dev instance behind it, set `K_BENCH_ALLOWED_LOGIN` (see [CONTRIBUTING](../../CONTRIBUTING.md#running-the-dev-instance)): Vite's proxy then adds the header to `/api` requests, standing in for `tailscale serve`.
