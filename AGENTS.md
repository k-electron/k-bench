# k-bench

k-bench is a web app, reachable only on the owner's tailnet, that runs persistent terminal Sessions on their Mac, organised into Workspaces.

This project uses pnpm.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on k-electron/k-bench, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

The repo holds only product: source, config and docs. Machine-local files (runtime data, logs, `.env*`, build output, editor and agent state) stay out of git, so when a change introduces a new kind of one, update `.gitignore` in the same change.

Never put real hostnames, tailnet names, logins, emails or personal paths in issues, PRs, commits, docs or screenshots. Use placeholders such as `<your-host>.<tailnet>.ts.net` and `you@example.com`.

When writing tests, see `docs/testing.md`.
