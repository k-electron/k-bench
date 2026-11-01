# Testing

Tests here are outcome-based: they check what the owner, or a client of the server's API, can observe, rather than how the code produces it.

- Go through the public seams: the server's HTTP/WebSocket API, or the UI in a real browser (Playwright). Use real tmux and real SQLite, isolated per test, rather than mocks of them.
- Avoid change detectors. Asserting on SQL rows, tmux commands issued, internal function calls, component internals or markup snapshots ties a test to the implementation, not the behaviour.
- Avoid tautologies. A test earns its place by being able to fail when the behaviour is wrong; one that recomputes the expected value with the code under test can't.
- Avoid brittleness. Wait for outcomes with a poll-until-timeout helper instead of fixed sleeps, and find UI elements by role and accessible name rather than CSS classes or DOM structure.
- Keep tests away from the Installed instance and the Dev instance: each test gets its own tmux socket and temporary data folder.
