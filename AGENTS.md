# k-bench

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on k-electron/k-bench, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

### .gitignore

The repo holds only product: source, config, docs. Anything machine-local (runtime data such as the SQLite DB, logs, `.env*`, build output, editor and agent local state) stays out of git. Whenever a change introduces a new kind of generated or machine-local file, update `.gitignore` in the same change.

### Testing

Tests are outcome-based: they assert what the owner (or a client of the server's API) can observe, never how the code produces it.

- Drive the system through its public seams: the server's HTTP/WebSocket API, or the UI in a real browser. Use real tmux and real SQLite (isolated per test), never mocks of them.
- No change detectors: don't assert on SQL rows, tmux commands issued, internal function calls, component internals, or snapshots of markup.
- No tautologies: a test must be able to fail when the behaviour is wrong, not just mirror the implementation.
- No brittleness: wait for outcomes with poll-until-timeout, never fixed sleeps. Select UI elements by role and accessible name, not by CSS classes or DOM structure.
