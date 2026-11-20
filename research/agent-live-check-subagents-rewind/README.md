# Live check: subagent messages, file restore and Ctrl+B in a Claude Agent

Issue [#178](https://github.com/k-electron/k-bench/issues/178), on the map [#175](https://github.com/k-electron/k-bench/issues/175). It feeds #185 (how much of a subagent's work the Transcript shows), #186 (restoring files from the web) and #188 (Ctrl+B).

**Setup.** The Owner's installed `claude` 2.1.329, Agent SDK 0.3.325, Haiku with low effort on every query. The runs used `pnpm live-check` and its rails: a throwaway folder, the settings files hashed before and after (byte-identical after both runs), cleanup by provenance, redacted recordings and a turn cap. The scenarios were added on this branch (see [Script changes](#script-changes)). **Turns spent: 13 of 15**, 10 in run 1 and 3 in run 2.

- Run 1: `--only subagent-messages,subagent-ask,rewind-files,ctrl-b-bash,ctrl-b-agent --budget 15`, giving [run-1-results.md](run-1-results.md) and [recordings/run-1/](recordings/run-1/). The Ctrl+B part was not provoked, because the script waited for a permission ask that never came. Claude Code runs `sleep 20; echo …` without calling `canUseTool`.
- Run 2: `--only ctrl-b-bash,ctrl-b-agent --budget 5`, with the cue changed to the foreground `task_started`. That gave [run-2-results.md](run-2-results.md) and [recordings/run-2/](recordings/run-2/). It also tried `rewindFiles` mid-turn.

The recordings are JSON lines (`dir: in|out|callback`) with paths redacted to `/home/you/project` and account fields to placeholders. In `run-2-results.md`, the `toolResultText` facts have some long words wrongly replaced by `<id>`. The script's ID pattern was too eager, and it is fixed on this branch. The quotes below come from the recording.

## 1. Subagents

The probe was one prompt that starts two subagents in the same message: `kb-writer` in the foreground (`run_in_background: false`), which writes one file, and `kb-reader` in the background, which reads one file and reports its first line. It ran once with `forwardSubagentText` off (as k-bench ships it, in the `rewind-files` session) and once with it on (`subagents` session). Source: [run-1-results.md](run-1-results.md), `subagent-messages`.

**Messages with `parent_tool_use_id` set: FAIL against the SDK's wording.** `sdk.d.ts` (`forwardSubagentText`) says that by default "only tool_use/tool_result blocks from subagents are emitted". With it off, the live run also sent text frames:

| Subagent               | `forwardSubagentText` | Frames | Bytes | Shapes, in order                                                                        |
| ---------------------- | --------------------- | ------ | ----- | --------------------------------------------------------------------------------------- |
| kb-writer (foreground) | off                   | 3      | 2,366 | `user[text]` (its prompt), `assistant[tool_use]`, `user[tool_result]`                   |
| kb-writer (foreground) | on                    | 4      | 3,276 | `user[text]`, `assistant[tool_use]`, `user[tool_result]`, `assistant[text]` (its reply) |
| kb-reader (background) | off                   | 3      | 2,668 | `assistant[tool_use]`, `user[tool_result]`, `assistant[text]` (its reply)               |
| kb-reader (background) | on                    | 3      | 2,653 | the same                                                                                |

- **Off:** a foreground subagent's prompt arrives as a `user` text frame. A background subagent's final reply arrives as an `assistant` text frame. Only the foreground subagent's own text is held back, and its report reaches the parent as the Agent tool's `tool_result` anyway.
- **On:** the foreground subagent's reply frame is added. Here that was one frame of about 900 bytes.
- **Other observations:**
  - There was no thinking, and no `stream_event` with a `parent_tool_use_id` in either mode.
  - Every subagent frame carries `agent_id`, equal to the subagent's `task_id`.
  - The model on every subagent assistant frame is Haiku.
  - A tiny one-tool task costs about 0.8 KB per frame and 2.4–3.3 KB per subagent.

**`getSubagentMessages(sessionId, agentId, {dir})`: PASS.** It returns 4 messages (about 2.9–3.1 KB) for each subagent: `user[text]` (the prompt), `assistant[tool_use]`, `user[tool_result]` and `assistant[text]`. That is the whole conversation, the same with `forwardSubagentText` on or off, foreground or background. `listSubagents(sessionId, {dir})` listed both subagents, and its IDs are the `task_id`s. Source: `sdk.d.ts` `getSubagentMessages`, `listSubagents`.

**`task_notification.output_file`:**

- **For a subagent:** a symlink in the system temp folder (`/tmp/claude-<uid>/<project>/<session>/tasks/<id>.output`). It points to the subagent's own transcript, `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`. For the one-tool task that transcript was 25–28 KB, 20 JSON lines, with the types `user`, `attachment`, `assistant`, `api-request`, `api-request-shape` and `api-request-blob`. It is Claude Code's raw transcript with internal request records, not a summary, and is about 8× the size of `getSubagentMessages`' answer.
- **For a Bash task (run 2):** a plain-text file of stdout followed by `[exited with code 0]`, 40 bytes.
- **Notification fields:** each subagent notification had `status: completed`, a `summary` (4–19 characters here) and `usage {total_tokens, tool_uses, duration_ms}`.

**A subagent's permission ask names the subagent: PASS.** The subagent's Write ask reached `canUseTool` with `options.agentID` equal to the subagent's `task_id` (and `agent_id`). This held in both sessions. No main-thread ask carried an `agentID`. Source: `sdk.d.ts` `CanUseTool` (`agentID`), recordings `callback` lines.

## 2. File restore (`rewindFiles`)

There was one live `Query` throughout, with no restart. Prompts: U1 Writes `a.txt`=v1 and `a2.txt`. U2 is sent during U1's first tool call and folded into it (one `result` for both). U4 is a Bash command that rewrites `a.txt`=v2 and creates `b.txt`. U5 is the two subagents above (kb-writer creates `sub-off.txt`). Then come a real rewind, a later turn, `/clear` and the rewinds after it. Source: [run-1-results.md](run-1-results.md), `rewind-files`, and `recordings/run-1/rewind-files.jsonl`.

| Call (before `/clear`)                     | Answer                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| dry run to U1                              | `canRewind: true`, `filesChanged` [a.txt, a2.txt], insertions 0, deletions 2 (files it created would be deleted) |
| dry run to U2 (folded into a running turn) | `canRewind: false`, `error: "No file checkpoint found for this message."`                                        |
| dry run to U4 (before Bash)                | `canRewind: true`, [a.txt], +1 −1                                                                                |
| dry run to U5 (before the subagent edit)   | `canRewind: true`, `filesChanged` [] (0/0)                                                                       |
| **real** rewind to U4                      | `{canRewind: true, skippedLinks: 0}`: no file list or counts on a real rewind                                    |
| dry run to U4 again                        | `canRewind: true`, [] (nothing left to restore)                                                                  |

On disk after the real rewind to U4, `a.txt` went from v2 to **v1**. `b.txt`, which only Bash had touched, **stayed**, and so did `sub-off.txt`, which the subagent had written. `a2.txt` stayed as it was.

**What works on a live `Query`, without a restart:**

- **A dry run, then a real restore.** The dry run gives the file list and the line counts. The real call restores and answers within milliseconds.
- **A Bash edit to a file that Write or Edit had already touched in the main conversation.** It is restored, because `a.txt` went back to v1.
- **A later turn.** The next turn ("replace v1 with v3 in a.txt") made the model Read the file, see `v1`, and Edit it to `v3` with no tool error. The restored file is what Claude works on.
- **Rewinding mid-turn** (run 2). While a foreground Bash was running, a dry run and then a real `rewindFiles` on that turn's own prompt each answered in 1–3 ms (`canRewind: true`, nothing to change). The turn carried on. This only shows that the call is answered and harmless mid-turn. It does not show a restore racing a tool that is writing at that moment.

**What doesn't work:**

- **A prompt folded into a running turn is not a restore point:** it gets `canRewind: false` with the error above.
- **A file that only Bash created or changed is not tracked.** `b.txt` was neither listed nor removed.
- **A subagent's edit is not tracked.** The dry run to U5 listed nothing, and `sub-off.txt` survived the rewind. This is as `file-checkpointing.md` says.
- **Nothing above a `/clear` can be restored.** After `/clear` (which also sent `conversation_reset` and an empty `background_tasks_changed`), every earlier prompt answered `canRewind: false`, "No file checkpoint found for this message." That held even for U6, the prompt just before the `/clear`. A real rewind to U1 then threw that error. `/clear` wipes every restore point, not only the conversation.
- **A real rewind does not report what it changed.** Only the dry run gives `filesChanged`, `insertions` and `deletions`, so a record of the restore has to come from the dry run taken just before it.

## 3. Backgrounding (`backgroundTasks()`, Ctrl+B)

Source: [run-2-results.md](run-2-results.md) and `recordings/run-2/ctrl-b.jsonl`. The trigger was the foreground `task_started` plus 4 s.

**Foreground Bash, `backgroundTasks()` with no tool_use id (the terminal's Ctrl+B): PASS.**

- **Before the call:** a foreground Bash already has a task, `task_started {task_type: local_bash, is_backgrounded: false}`.
- **The call:** the control response was `{}`, and the SDK returned `true`. Then `background_tasks_changed` (1 task) and `task_updated {patch: {is_backgrounded: true}}` arrived.
- **The tool result:** the blocked Bash call returned about 1 s later as an ordinary tool_result: "Command was manually backgrounded by user with ID: …. Output is being written to: …/tasks/<id>.output. If it is still running after 30m …, it will be stopped and you will be notified." Its `tool_use_result` has `backgroundTaskId` and `backgroundedByUser`.
- **The turn carried on** and ended (`result`) about 5 s after the call, while the command still ran. Haiku read the empty output file and replied "FINISHED" too early.
- **When the command finished** (about 13 s later): `task_updated {status: completed}`, `task_notification {status: completed, tool_use_id: <the Bash call>}` with the output file (`kb-livecheck-done`, `[exited with code 0]`), and `background_tasks_changed` (0). The notification **started a turn nobody sent**, in which the model read the output and corrected itself. That turn counts against the budget.

**Foreground subagent, `backgroundTasks(<the Agent call's tool_use id>)`: PASS.**

- **The call:** the control response was `{backgrounded: true}`. Then `background_tasks_changed` (1) and `task_updated {is_backgrounded: true}` arrived.
- **The tool result:** within about 60 ms the Agent call returned the same tool_result as an asynchronous launch ("Async agent launched successfully …", `tool_use_result.status: "async_launched"`, with `agentId`, `outputFile` and `isAsync`). The turn ended about 2.3 s after the call.
- **The subagent kept running:**
  - Its own foreground Bash finished, and a main-level `task_notification` named the subagent's Bash call (that Bash had its own `task_started local_bash`).
  - Its reply arrived as an `assistant[text]` frame with `parent_tool_use_id`.
  - Then came `task_notification` for the Agent call and `background_tasks_changed` (0).
- **The next turn:** the session was closed at that point, so the turn the notification started is not in the count.
- **Run 1 shows the same subagent left in the foreground.** Its inner Bash also emits `task_started local_bash`, and no `task_notification` ends it. `TaskTracker` drops foreground tasks at the turn's `result`, so this does no harm.

`TaskTracker` (`src/agent-runtime/tasks.ts`) already reads `task_updated {is_backgrounded: true}`, so a task the Owner backgrounds would move to the background list without new code there.

## Side finding: the Bash rail

Claude Code ran `sleep 20; echo kb-livecheck-done` **without a permission ask**, so `canUseTool` (and with it the live check's `decideTool`) never saw it. Claude Code treats commands like this as read-only. The live check's Bash rail therefore only gates commands that Claude Code asks about. `printf … > a.txt && …` did ask. The other layers (`disallowedTools`, the throwaway folder) still hold.

## What this changes for #185, #186 and #188

- **#185 (subagent work in the Transcript).**
  - **Already logged:** k-bench's log already holds every subagent's tool calls and results, a foreground subagent's prompt and a background subagent's reply, all tagged with `agent_id` = `task_id`. Showing the work nested under the task line needs no new option. It only needs `web/src/agent/items.ts` to stop dropping frames with a `parent_tool_use_id`.
  - **`forwardSubagentText`** adds only a foreground subagent's own text. It is cheap: about 0.9 KB here, with no thinking.
  - **A drill-in view** can call `getSubagentMessages`, which returns the full conversation at about 3 KB for a small task.
  - **`output_file`** is the raw transcript with internal records (8× bigger). Don't show it.
  - **Asks:** `agentID` arrives on every subagent ask, so an ask can name its subagent.
- **#186 (restore files from the web).**
  - **Confirmed limits:** Bash-only and subagent edits are untracked, a folded prompt has no checkpoint, and nothing above `/clear` can be restored.
  - **Two corrections to the ticket's framing.** `/clear` wipes **every** restore point, including prompts just before it, so the restore entry must disappear from all prompts above a `/clear`. A real rewind returns no file list, so the confirm step and the Transcript record must keep the dry run's `filesChanged`, `insertions` and `deletions`.
  - **Mid-turn:** the call is answered and harmless.
  - **After a restore:** a later turn sees the restored file.
- **#188 (Ctrl+B).**
  - **It works on both kinds of task:** `backgroundTasks()` turns a blocking Bash or foreground subagent into a background task in about 1 s. The turn carries on, and the task then shows through the same `background_tasks_changed` / `task_notification` signals k-bench already renders, with its own Stop.
  - **Costs to weigh:** the finished task's notification starts a model turn by itself, and the model may answer too early ("FINISHED" before the command ended).
  - **The other route:** asking Claude to run long work in the background works when asked. Haiku honoured `run_in_background` as told in every probe, `true` and `false`. That route needs someone to foresee the wait before the call. Ctrl+B is the only way out once a call is already blocking, short of an interrupt that kills it.

## Script changes

These are on this branch only, not on `main`:

- **`scripts/live-check/subagents-rewind.ts`:** three scenarios (`rewind-files`, `ctrl-b`, `subagents`) and five checks (`subagent-messages`, `subagent-ask`, `rewind-files`, `ctrl-b-bash`, `ctrl-b-agent`).
- **`scripts/live-check.ts`** registers them after the existing ones, and **`scripts/live-check/types.ts`** adds the scenario names.
- **`scripts/live-check/session.ts`:**
  - `SessionSpec.forwardSubagentText`.
  - The `Ask` records `canUseTool`'s `agentID` and `toolUseID`, which also appear on the recordings' `callback` lines.
  - `Run.taskOutputs` collects each `task_notification.output_file`.
- **`scripts/live-check/provenance.ts`:** cleanup also removes the task-output folder named after the throwaway folder (`/tmp/claude-<uid>/<project>`), found by walking up from each output file the run was told of.
- **`scripts/live-check/privacy.ts`:** the throwaway folder's derived name (`projects/<name>`) is redacted to `-home-you-project`.

Both runs were rehearsed with `--fake` first. `test/live-check*.test.ts` pass.
