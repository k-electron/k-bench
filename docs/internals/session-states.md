# Claude Session states

A running Claude Session is Working, Waiting or Idle (see the [glossary](../../GLOSSARY.md)). The state reaches clients as each Session's `activity` in [the state](api.md#the-state). How it shows is in the [guide](../guide/claude-code.md#see-what-a-claude-session-is-doing).

## Mechanism

**Claude Code's hooks**, the way k-bench already follows the conversation ([ADR 0005](../adr/0005-k-bench-launches-claude-code.md)). `src/server/claude.ts` adds them to the `--settings` every launch passes:

| Event                                        | State   |
| -------------------------------------------- | ------- |
| `SessionStart`, except with source `compact` | Idle    |
| `UserPromptSubmit`                           | Working |
| `Stop`                                       | Idle    |
| `StopFailure` (an API error ended the turn)  | Idle    |

Each hook writes the state to the tmux pane option `@kb-activity` on its own pane and signals the tmux `wait-for` channel `kb-activity-changed`. The server waits on that channel as it does for [the Bell](bell.md#mechanism), so a change reaches the events WebSocket at once. `list-sessions` reads the option back with the rest of the live state, and the service reports it only for a running Claude Session. An empty option, before any hook has run, reads as Idle.

## Why

- The state lives in tmux ([ADR 0002](../adr/0002-tmux-is-the-source-of-truth-for-liveness.md)), on the pane, like the conversation ID. It survives a k-bench restart and needs no store column. It goes when the Session's program does, when the Session is Stopped and has no state anyway.
- Claude Code adds what a `SessionStart` or `UserPromptSubmit` hook prints to the conversation, so every hook prints nothing and always exits 0. They write only k-bench's own words, never anything read from their input.
- An event fired inside a subagent carries an `agent_id`, and the hooks ignore it: a subagent finishing says nothing about the Session's own turn.
- `SessionStart` also fires on compaction, which can happen partway through a turn, so compaction leaves the state alone.

## Known limitations

What a Session shows when its hooks don't run, when an older k-bench started it, or when the owner interrupts a turn is in the [guide](../guide/claude-code.md#see-what-a-claude-session-is-doing).
