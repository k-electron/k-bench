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
