# k-bench launches and resumes Claude Code, and never reads it

k-bench exists to manage Claude Code work, so it has a Claude Session: a Session that runs Claude Code itself, launched with options the owner picks in a dialog (model, effort, advisor, Focus view). k-bench gives each Claude Session a conversation ID of its own choosing at launch, so restarting a Stopped Claude Session resumes exactly that Claude conversation with the same options.

The boundary is Claude Code's command-line launch contract. k-bench passes documented flags and resumes by ID. It never detects Claude Code running in an ordinary Session, never parses its output, and never reads its files. Launch flags are documented and stable. Screen and file formats change with every release.

This replaces an earlier decision that k-bench knows nothing about Claude Code. That decision kept k-bench general, but it left every launch to typing flags by hand and every restart to `/resume`, and that friction was worst on a phone.

## Considered Options

- **A generic per-Session start command, with Claude knowledge only in the web client.** This keeps the server Claude-agnostic. But a precise resume needs the server to remember a conversation ID and build a different command on restart, which already means knowing about Claude.
- **Detecting Claude Code in any Session, by process or output.** It would mark Sessions where you typed `claude` yourself. It means scraping, which breaks silently when Claude Code changes.

## Consequences

- The dialog doesn't encode Claude Code's rules, such as which model can advise which. Claude Code rejects a bad combination at launch. When Claude Code exits with an error, the Session holds the screen until the owner presses a key, so the error can be read.
- When Claude Code exits, its Session is Stopped. There is no shell underneath.
- A Claude Session's options are fixed for its life. Restarting passes them again, because Claude Code doesn't restore per-launch settings on resume. Changes mid-conversation go through Claude Code's own commands, such as `/model`.
- Claude Code saves a conversation only after its first message. A restart tries to resume and, if there's nothing to resume, starts a fresh conversation with the same ID and options.
- Public docs that describe k-bench as knowing nothing about Claude Code must be rewritten along with the feature.

## Amended

ADR-0007 amends this decision for Claude Agent, which consumes the Agent SDK's published messages. A Claude TUI is unchanged.
