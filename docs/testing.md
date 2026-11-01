# Testing

Tests here are outcome-based: they check what the owner, or a client of the server's API, can observe, rather than how the code produces it.

- Go through the public seams: the server's HTTP/WebSocket API, or the UI in a real browser (Playwright). Use real tmux and real SQLite, isolated per test, rather than mocks of them.
- Avoid change detectors. Asserting on SQL rows, tmux commands issued, internal function calls, component internals or markup snapshots ties a test to the implementation, not the behaviour.
- Avoid tautologies. A test earns its place by being able to fail when the behaviour is wrong; one that recomputes the expected value with the code under test can't.
- Wait for outcomes with the poll helper (`pollUntil`, or `waitForOutput` on a terminal), and find UI elements by role and accessible name (`getByRole`, `getByLabel`, `getByText`). Biome enforces both in `test/` and `e2e/`. When a sleep is genuinely the only option, such as proving that something does _not_ happen, put a `biome-ignore` comment on it giving the reason.
- Isolation is built into the harness: every test instance gets its own temp data folder and a tmux socket named after the test run, and a run fails if it leaves any of its sockets behind. Create instances through the harness so they're disposed.

To try a production build by hand, run `pnpm smoke` (add `--hold` to keep it up for manual requests). Everything it starts is cleaned up when it exits, which a server started in the background by hand is not.
