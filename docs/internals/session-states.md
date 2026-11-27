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

**The quiet decay.** A Working Session that has printed nothing for 15 seconds (`workingQuietMs` in the instance config) becomes Idle. Whenever the service reads the state, it compares tmux's `#{window_activity}`, the time of the Session's last output, with the time the state was last written, which every hook and `endWaiting` stamp in the pane option `@kb-activity-at`. When both are older than the quiet time, `TmuxDriver.decayWorking` writes Idle back to `@kb-activity`, in one tmux call that checks all three again, so a hook or key that has just written the state is never overwritten. The state feed's [poll](bell.md#the-events-websockets-poll) is what notices the quiet, so there is no timer of its own.

## Why

- The state lives in tmux ([ADR 0002](../adr/0002-tmux-is-the-source-of-truth-for-liveness.md)), on the pane, like the conversation ID. It survives a k-bench restart and needs no store column. It goes when the Session's program does, when the Session is Stopped and has no state anyway.
- Claude Code adds what a `SessionStart` or `UserPromptSubmit` hook prints to the conversation, so every hook prints nothing and always exits 0. They write only k-bench's own words, never anything read from their input.
- `PermissionRequest` fires as the prompt shows. The `Notification` for a permission prompt comes about six seconds later, so k-bench doesn't use it.
- A question and a plan to approve are tools (`AskUserQuestion`, `ExitPlanMode`) that wait on the owner, so their `PreToolUse` means Waiting; the hook group's matcher names just those two. The hooks reference doesn't say whether a plan approval also fires `PermissionRequest`. If it does, both say Waiting.
- Claude Code fires no hook when the owner denies a prompt, so the owner's key ends Waiting. It's also how they answer, so Waiting never outlasts the answer.
- Viewing a Session doesn't touch `@kb-activity`, so it never clears Waiting; it clears only the Bell.
- An event that carries an `agent_id` fired inside a subagent or a teammate. A subagent's tools say nothing about the Session's own turn, so their hooks ignore it, and k-bench doesn't hook `SubagentStop` at all; `Stop` fires only for the main agent. A subagent's `PermissionRequest` or `Elicitation` still means Waiting, since a prompt needs the owner whoever asked. That Waiting ends as any other does, with the owner's key or the main agent's next hook. `PermissionRequest` also fires for a call that can't prompt, so a background subagent can leave a Session Waiting with nothing on screen until then. The hooks reference documents `agent_id` only for subagents and teammates. The main agent started with `--agent` carries `agent_type` instead, so the hooks never test `agent_type`.
- `SessionStart` also fires on compaction, which can happen partway through a turn, so compaction leaves the state alone.
- Claude Code fires no hook when the owner interrupts a turn, and a wrong Idle is better than a wrong Working, so a quiet Working Session decays. Claude Code redraws its spinner and elapsed time about every second during a turn, even through one long, silent tool call and in Focus view, so 15 seconds of quiet means the turn is over.
- The decay latches: Idle is written back to tmux rather than worked out afresh on each read. An idle Claude Code still redraws now and then (about every 30 to 55 seconds, likely its status line), and each redraw would otherwise bring Working back for 15 seconds. Only a hook or the owner's key moves a decayed Session on.
- The stamp is there because a state can be written while the output is old: the owner's key ends a long Waiting before Claude Code redraws, and a prompt can be sent after a quiet spell. Without it the decay could idle a turn that had just started.
- Waiting never decays. A permission prompt doesn't redraw, and Waiting is the state the owner most needs to see.
- `#{window_activity}` is the Session's pane's last output, since a Session is one window with one pane. It counts whole seconds, which is plenty against 15. A Session started before the stamp existed has none, which counts as long ago.

## Known limitations

What a Session shows when its hooks don't run, when an older k-bench started it, or when the owner interrupts a turn is in the [guide](../guide/claude-code.md#see-what-a-claude-session-is-doing).
