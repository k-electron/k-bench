# Testing

Tests here are outcome-based: they check what the owner, or a client of the server's API, can observe, rather than how the code produces it.

- Go through the public seams: the server's HTTP/WebSocket API, the UI in a real browser (Playwright), or, for the installer and the other `k-bench` commands that change the real machine, the packed `k-bench` command run as a process with stub `tailscale`, `tmux` and `launchctl` programs on PATH. Use real tmux and real SQLite, isolated per test, rather than mocks of them. Three modules are the exceptions, tested at their own interface because their seam can't time what matters:
  - `Attachments`, a terminal's life on a Session: races the WebSocket can't time, such as stopping while a terminal is still looking up its Session. Tested in `test/attachments.test.ts`, with real tmux and a Session lookup the test controls in place of the store.
  - The browser's state client (`web/src/stateClient.ts`): waiting for a change to show, and reconnecting across a server restart, which Playwright can't see. Tested in `test/state-client.test.ts` against a real Seam 1 server.
  - The browser's terminal connection (`web/src/terminalConnection.ts`): input typed before the socket opens, reconnecting across a server restart, and what is dropped while a retry waits, which Playwright can't see. Tested in `test/terminal-connection.test.ts` against a real Seam 1 server.
- Avoid change detectors. Asserting on SQL rows, tmux commands issued, internal function calls, component internals or markup snapshots ties a test to the implementation, not the behaviour.
- Avoid tautologies. A test earns its place by being able to fail when the behaviour is wrong; one that recomputes the expected value with the code under test can't.
- Wait for outcomes with the poll helper (`pollUntil`, or `waitForOutput` on a terminal), and find UI elements by role and accessible name (`getByRole`, `getByLabel`, `getByText`). Biome enforces both in `test/` and `e2e/`. When a sleep is genuinely the only option, such as proving that something does _not_ happen, put a `biome-ignore` comment on it giving the reason.
- Isolation is built into the harness: every test instance gets its own temp data folder and a tmux socket named after the test run, and a run fails if it leaves any of its sockets behind. Create instances through the harness so they're disposed.

To try a production build by hand, run `pnpm smoke` (add `--hold` to keep it up for manual requests). Everything it starts is cleaned up when it exits, which a server started in the background by hand is not.
