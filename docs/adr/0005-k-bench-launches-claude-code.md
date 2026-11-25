# k-bench launches Claude Code, may read it, and never steers it

k-bench exists to manage Claude Code work, so it has a Claude Session: a Session that runs Claude Code itself, launched with options the owner picks in a dialog (model, effort, advisor, Focus view). k-bench launches and resumes Claude Code. It gives each Claude Session a conversation ID of its own choosing at launch, and restarting a Stopped Claude Session resumes the Claude conversation last running in it, with the same options.

The owner often moves to another conversation inside Claude Code (`/clear`, `/resume`, `/branch`, `/fork`), which gives it a new conversation ID. k-bench follows the conversation through Claude Code's documented `SessionStart` hook. Every launch passes `--settings` with a hook that prints nothing, records the conversation ID on the Session's tmux pane and signals k-bench, which stores the new ID. Every source counts (`startup`, `resume`, `clear`, `compact` or one added later), because a `/restart` before the first message gives a new ID with source `startup`. Compaction keeps the ID.

The boundary is two rules:

1. **Never fail when Claude Code changes.** k-bench may read anything Claude Code produces: its flags, its hook input, its output or its files. Formats change with every release, so whatever k-bench reads it must degrade gracefully when the format changes. A conversation ID that isn't UUID-shaped is ignored, and when hooks don't run (an untrusted folder, or `disableAllHooks`) k-bench keeps the last conversation it knew.
2. **Never steer Claude beyond the owner's Launch options.** The model, effort, advisor and Focus view the owner chose are the only things k-bench changes about what Claude sees or does. Anything else k-bench adds, like the conversation hook, must not change them: the hook prints nothing, so nothing reaches the conversation, and it always exits successfully.

k-bench still never detects Claude Code running in an ordinary Session: typing `claude` in one just runs a program.

This replaces an earlier decision that k-bench knows nothing about Claude Code. That decision kept k-bench general, but it left every launch to typing flags by hand and every restart to `/resume`, and that friction was worst on a phone. It also replaces this ADR's first boundary, that k-bench never reads Claude Code's output or files. Keeping to the launch contract alone meant a restart after `/clear` silently went back to the old conversation.

## Considered Options

- **A generic per-Session start command, with Claude knowledge only in the web client.** This keeps the server Claude-agnostic. But a precise resume needs the server to remember a conversation ID and build a different command on restart, which already means knowing about Claude.
- **Detecting Claude Code in any Session, by process or output.** It would mark Sessions where you typed `claude` yourself.
- **Following the conversation by reading Claude Code's conversation files**, such as the newest transcript in the folder. It guesses when several conversations share a folder, and the file layout is undocumented. The hook is documented and names the conversation exactly.

## Consequences

- The dialog doesn't encode Claude Code's rules, such as which model can advise which. Claude Code rejects a bad combination at launch. When Claude Code exits with an error, the Session holds the screen until the owner presses a key, so the error can be read.
- When Claude Code exits, its Session is Stopped. There is no shell underneath.
- A Claude Session's options are fixed for its life. Restarting passes them again, because Claude Code doesn't restore per-launch settings on resume. Changes mid-conversation go through Claude Code's own commands, such as `/model`.
- Claude Code saves a conversation only after its first message. A restart tries to resume and, if there's nothing to resume, starts a fresh conversation with the same ID and options. This works the same for a followed conversation that never had a message.
- `--settings` is passed on every launch, not only with Focus view on. It adds to the owner's own settings and hooks for that launch and leaves their files unchanged.
- One conversation ID is kept per Claude Session, updated in place, with no history. Earlier conversations are still reachable through Claude Code's own `/resume`. Two Sessions can end up on one conversation, and nothing guards against it.
- Public docs that describe k-bench as knowing nothing about Claude Code must be rewritten along with the feature.
