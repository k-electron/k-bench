# Claude Session states

A running Claude Session is Working, Waiting or Idle (see the [glossary](../../GLOSSARY.md)). The state reaches clients as each Session's `activity` in [the state](api.md#the-state). How it shows is in the [guide](../guide/claude-code.md#see-what-a-claude-session-is-doing).

## Mechanism

**Claude Code's hooks**, the way k-bench already follows the conversation ([ADR 0005](../adr/0005-k-bench-launches-claude-code.md)). `src/server/claude.ts` adds them to the `--settings` every launch passes:

| Event                                                 | State   |
| ----------------------------------------------------- | ------- |
| `SessionStart`, except with source `compact`          | Idle    |
| `UserPromptSubmit`                                    | Working |
| `PermissionRequest` (a permission prompt)             | Waiting |
| `PreToolUse` for `AskUserQuestion` and `ExitPlanMode` | Waiting |
| `Elicitation` (an MCP server's question)              | Waiting |
| `PostToolUse`, `PostToolUseFailure`                   | Working |
| `ElicitationResult`                                   | Working |
| `Stop`                                                | Idle    |
| `StopFailure` (an API error ended the turn)           | Idle    |

Each hook writes the state to the tmux pane option `@kb-activity` on its own pane and signals the tmux `wait-for` channel `kb-activity-changed`. The server waits on that channel as it does for [the Bell](bell.md#mechanism), so a change reaches the events WebSocket at once. `list-sessions` reads the option back with the rest of the live state, and the service reports it only for a running Claude Session. An empty option, before any hook has run, reads as Idle.

**The owner's key.** Any key the owner sends a Waiting Session through k-bench makes it Working: `attachments.ts` passes each key to `TmuxDriver.endWaiting`, which changes `@kb-activity` only while it still says Waiting. Input the browser's terminal sends by itself doesn't count, and neither do mouse reports: a scroll or a click isn't an answer.

## Why

- The state lives in tmux ([ADR 0002](../adr/0002-tmux-is-the-source-of-truth-for-liveness.md)), on the pane, like the conversation ID. It survives a k-bench restart and needs no store column. It goes when the Session's program does, when the Session is Stopped and has no state anyway.
- Claude Code adds what a `SessionStart` or `UserPromptSubmit` hook prints to the conversation, so every hook prints nothing and always exits 0. They write only k-bench's own words, never anything read from their input.
- `PermissionRequest` fires as the prompt shows. The `Notification` for a permission prompt comes about six seconds later, so k-bench doesn't use it.
- A question and a plan to approve are tools (`AskUserQuestion`, `ExitPlanMode`) that wait on the owner, so their `PreToolUse` means Waiting; the hook group's matcher names just those two. The hooks reference doesn't say whether a plan approval also fires `PermissionRequest`. If it does, both say Waiting.
- Claude Code fires no hook when the owner denies a prompt, so the owner's key ends Waiting. It's also how they answer, so Waiting never outlasts the answer.
- Viewing a Session doesn't touch `@kb-activity`, so it never clears Waiting; it clears only the Bell.
- An event that carries an `agent_id` fired inside a subagent or a teammate, so the hooks ignore it: a subagent's tool finishing says nothing about the Session's own turn. k-bench doesn't hook `SubagentStop` at all, and `Stop` fires only for the main agent. The hooks reference documents `agent_id` only for subagents and teammates. The main agent started with `--agent` carries `agent_type` instead, so the hooks never test `agent_type`. The reference doesn't say whether a subagent's own permission prompt carries `agent_id`. If it does, that prompt shows Working, not Waiting. Waiting never decays, and `PermissionRequest` also fires for a call that can't prompt, so a background subagent's prompt counted as Waiting could stick for good.
- `SessionStart` also fires on compaction, which can happen partway through a turn, so compaction leaves the state alone.

## Known limitations

What a Session shows when its hooks don't run, when an older k-bench started it, or when the owner interrupts a turn is in the [guide](../guide/claude-code.md#see-what-a-claude-session-is-doing).
