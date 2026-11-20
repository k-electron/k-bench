# Live check: hooks, starting mode, denials and refusals in a Claude Agent

Issue [#177](https://github.com/k-electron/k-bench/issues/177), on the map [#175](https://github.com/k-electron/k-bench/issues/175). This is what the owner's installed `claude` (2.1.329, Agent SDK 0.3.325, Haiku at low effort) actually sends for the things the [gap analysis](https://github.com/k-electron/k-bench/tree/research/agent-sdk-gap-analysis/research/agent-sdk-gap-analysis) could only read from types. It was run on 2026-11-20.

## Answers

| #   | Question                                      | Verdict                                                                         |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| 1a  | Which `hook_*` messages arrive, option on/off | **FAIL** for k-bench: with the option unset, only SessionStart arrives          |
| 1b  | A hook's `systemMessage`                      | **PASS**: it is not drawn as Claude's words. The gap analysis was wrong here    |
| 1c  | Non-blocking errors and blocking reasons      | **FAIL**: one block reason (a JSON deny) is drawn nowhere                       |
| 1d  | The owner's own hooks with the option on      | **FAIL** (noise): 2 hook lines on every plain turn                              |
| 2   | Starting mode                                 | **FAIL**: the Agent starts in `default`, the terminal in `auto`                 |
| 3   | Denials                                       | **FAIL**: `permission_denied` carries the reason; k-bench shows a bare "Denied" |
| 4   | Refusals and fallback                         | **NOT PROVOKED**                                                                |
| 5   | Rate-limit fields                             | **PASS** for the status line; `utilization` is not where k-bench reads it       |

### 1. Hooks

The check's own command hooks were passed in the session's `settings` (flag tier; the owner's files were never touched): UserPromptSubmit, PreToolUse on Read, Glob and Grep, PostToolUse on Read, and Stop. Each prints a marked text. The owner's own user-level hooks ran as well, as they do in k-bench; their output is kept only as a length label.

**a. Which messages arrive** ([run-3/replayed.md](run-3/replayed.md) `hook-events`; [run-3/recordings/hooks.jsonl](run-3/recordings/hooks.jsonl), session 1):

- **`includeHookEvents: true`**: every hook gets a `hook_started` and then a `hook_response` (`hook_id`, `hook_name` such as `PreToolUse:Read` or `Stop`, `hook_event`, `output`, `stdout`, `stderr`, `exit_code`, `outcome` `success` or `error`). That holds for PreToolUse, PostToolUse, UserPromptSubmit and Stop. No `hook_progress` came for these short hooks. Several hooks on one event run in parallel: their `hook_started` messages come first, then their responses in any order.
- **Option unset** (as `ClaudeSession` in `src/agent-runtime/session.ts` launches): only `hook_started` and `hook_response` for `SessionStart:startup` arrive. This confirms the gap analysis: k-bench's hook line (`web/src/agent/uncommon.ts` `readSystem`, `hook_response`) never fires for the other events.

**b. `systemMessage`** ([hooks.jsonl](run-3/recordings/hooks.jsonl) lines 29, 36, 50, 94, 100): it arrives as **`system/informational`, `level: "notice"`, `content: "<hook name> says: <message>"`**, both with the option on and with it unset. It does **not** arrive as an `is_meta` assistant message, and no `is_meta` assistant message came at all. The gap analysis's claim (2-interaction-loop.md row 4, "drawn as Claude's own reply") is **refuted**: `web/src/agent/items.ts` `buildItems` draws no hook text as an `assistant` item. `uncommon.ts` `readSystem` draws the informational as a `notice` item.

- Unset (today): each `systemMessage` already shows once, as a notice. The gap analysis's "a `systemMessage` is invisible" is refuted too.
- On: each shows **twice**. `uncommon.ts` `hookLines` also takes `systemMessage` out of the hook's JSON stdout, so the hook line repeats the notice. `hookLines` assumes a `systemMessage` is only in the stdout; Claude Code already sends it separately.

**c. Errors and blocks** ([run-3/replayed.md](run-3/replayed.md) `hook-blocks`):

| Hook                                          | What arrives                                                                                                                                                                                                                                                                                                                                                                                                                    | What k-bench draws (option on)                                                                              | Option unset                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| PostToolUse, exit 1 (non-blocking error)      | `hook_response` `outcome: "error"`, `exit_code: 1`, the text in `stderr`. Nothing else: no informational, nothing in the tool result                                                                                                                                                                                                                                                                                            | a hook line, outcome error                                                                                  | **nothing at all**                                               |
| PostToolUse, plain stdout, exit 0             | `hook_response` `success`, the text in `stdout`                                                                                                                                                                                                                                                                                                                                                                                 | a hook line                                                                                                 | nothing                                                          |
| PreToolUse, exit 2 (blocking)                 | `hook_response` `error`, `exit_code: 2`, the text in `stderr`; the tool's `tool_result` `is_error: true`, content `PreToolUse:Glob hook error: [<the hook's command line>]: <stderr>`, with `tool_result_meta: [{id, non_execution_kind: "permission-rule", permission_decision: {decision: "reject", source: "hook", reason_type: "hook"}}]`                                                                                   | a hook line (error); the tool is drawn **Denied with no text** (`items.ts` `resolveTool`, `rejectedByMeta`) | the tool shows **Denied, the reason lost**                       |
| PreToolUse, JSON `permissionDecision: "deny"` | `hook_response` **`success`**, `exit_code: 0`; `tool_result` `is_error: true`, content `PreToolUse:Grep hook error: <permissionDecisionReason>`, the same `tool_result_meta` ([hooks.jsonl](run-3/recordings/hooks.jsonl) lines 60-61)                                                                                                                                                                                          | **nothing holds the reason**: `hookLines` shows only a `systemMessage` from JSON, and the tool says Denied  | the tool shows Denied, the reason lost                           |
| UserPromptSubmit, `decision: "block"`         | `hook_response` success; then `system/informational` **`level: "warning"`**, `content: "UserPromptSubmit operation blocked by hook:\n<reason>\n\nOriginal prompt: <prompt>"`, with **`prevent_continuation: true`** and **`prompt_submit_outcome: {kind: "blocked_by_hook", prompt_kept: false, reason}`**; then a `result` `success`, `num_turns: 0`, `is_error: false` ([hooks.jsonl](run-3/recordings/hooks.jsonl) line 104) | a warning notice                                                                                            | not tried unset; the informational does not depend on the option |

`prompt_submit_outcome` is not in the SDK's types (`sdk.d.ts` `SDKInformationalMessage` has `prevent_continuation` and `tag` only). The blocked prompt reached no model (`num_turns: 0`).

**d. The owner's own hooks, option on** ([run-2/results.md](run-2/results.md) `owner-hook-lines`, one plain "pong" turn): 3 `hook_response`s (SessionStart, UserPromptSubmit, Stop), all `success`, all with JSON stdout and text on stderr. k-bench would draw **2 hook lines on every turn** (UserPromptSubmit and Stop, one line each, from their stderr), because `hookLines` shows a successful hook's stderr. The replay's owner count is higher (6) only because a redacted output is a text label; the live count is 2. What the terminal shows for such hooks was not checked.

### 2. Starting mode

[run-2/results.md](run-2/results.md) `start-mode`; [run-2/recordings/start-mode.jsonl](run-2/recordings/start-mode.jsonl). The owner's `permissions.defaultMode` is absent from `settings.json`, and there is no `settings.local.json`.

| Launch, model Haiku                                     | Mode                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| SDK, no `permissionMode`, `canUseTool` set (as k-bench) | `current_permission_mode: "default"`; the first turn's `init.permissionMode: "default"` |
| SDK, no `permissionMode`, no `canUseTool`               | `current_permission_mode: "default"`                                                    |
| TUI, no `--permission-mode`, same folder and settings   | footer **`auto mode on`**                                                               |

Every model row says `supportsAutoMode: true`, Haiku included. So an Agent starts in **manual** (`default`) where the owner's terminal starts in **auto**, and the gap analysis's worry runs the other way. The SDK docs are right (typescript.md, `permissionMode`: "the session starts in `default`"; permissions.md: "With Claude Code v2.1.302 or later, your app starts in `default` mode"). The comment in `sdk.d.ts` (`permissionMode`, "else `'auto'` where that is the default") is out of date. k-bench's display is right because it reads the mode back (`ClaudeSession.permissionMode`). Its comment "the owner's settings decide it" in `src/agent-runtime/session.ts` is only half right: with no `defaultMode`, the SDK's default and the terminal's default differ.

### 3. Denials

[run-2/results.md](run-2/results.md) `denial-shape`; [run-2/recordings/denials.jsonl](run-2/recordings/denials.jsonl) lines 19 and 44.

- **Deny rule** (`WebFetch(domain:example.com)` in the session's settings, default mode): `system/permission_denied` with `tool_name`, `tool_use_id`, **`decision_reason_type: "rule"`**, `message: "WebFetch denied access to domain:example.com."`, and **no `decision_reason`**. `canUseTool` was never called. Beside it, the `tool_result` has `is_error: true` and text identical to `message`. `result.permission_denials` lists 1 entry (`tool_input`, `tool_name`, `tool_use_id`). Haiku first called `ToolSearch` (WebFetch is a deferred tool), which ran without an ask.
- **`dontAsk`** (Write in the throwaway folder): `permission_denied` with **`decision_reason_type: "mode"`**, no `decision_reason`, and `message: "Permission to use Write has been denied because Claude Code is running in don't ask mode. IMPORTANT: You *may* attempt to accomplish this action using other tools …"`. The `tool_result` is identical, with `is_error: true`. `canUseTool` was never called.
- **From a subagent** (run 1, whose Haiku handed the fetch to a subagent before `Agent` was denied too): the same message plus **`agent_id`**. The `Agent` tool ran without an ask.
- **What k-bench draws**: the tool line says **"Denied" with no text** in both cases (`web/src/agent/items.ts` `resolveTool`, via `rejectedByMeta`; it drops `lines`), and `permission_denied` draws nothing (`uncommon.ts` `readSystem` falls through). The reason arrives three times (the `permission_denied`, the `tool_result` and `tool_result_meta`) and is shown none of them.
- **The auto-mode classifier**: NOT PROVOKED. In auto mode the classifier approves calls without `canUseTool`, which would step outside the live check's tool rail.

### 4. Refusals and fallback

**NOT PROVOKED.** A refusal needs a prompt the model refuses (a safety category), and the check does not send one. Neither `model_refusal_fallback` nor `model_refusal_no_fallback` appeared in any of the 13 turns. The shapes remain as typed in `sdk.d.ts` (`SDKModelRefusalFallbackMessage`, `SDKModelRefusalNoFallbackMessage`).

### 5. Rate-limit fields

[run-2/results.md](run-2/results.md) `rate-limit`. The recordings hold the scrubbed fixture values (`scripts/redaction.ts` `scrub`), so the labels below come from the live messages.

- One `rate_limit_event` per model turn (every turn, not only the first; none for the blocked prompt), `status: "allowed"`, `rateLimitType: "five_hour"`, `resetsAt` (seconds) under 6 h away.
- Overage fields: `overageStatus: "rejected"`, `overageDisabledReason: "org_level_disabled"`, `isUsingOverage: false`. There was no `overageResetsAt`, `overageInUse` or `overageEnabled`.
- **No top-level `utilization`.** Instead there is **`unifiedWindows`**, which is not in the SDK's types: `{five_hour: {status, resetsAt, utilization}, seven_day: {status, resetsAt, utilization}}`, with utilization between 0.1 and 0.2 (five hours) and between 0.4 and 0.5 (seven days), as fractions of 1.
- `uncommon.ts` `readRateLimit` is right to stay quiet on `allowed`. But its "(N% used)" reads `info.utilization`, which this account's events do not carry. A warning would show without a percentage unless it read `unifiedWindows[<rateLimitType>].utilization`.

## What this changes for #181 and #182

- **#181 (asks and denials)**: a denial's reason arrives three ways and is dropped. A rule denial's text names the rule's specifier (`domain:example.com`), and a `dontAsk` denial explains the mode. `decision_reason` was absent in both, so the line must come from `message` and `decision_reason_type`. Denials happen without any ask (`canUseTool` is not called). A hook's PreToolUse deny looks the same in the tool result (`source: "hook"` in `tool_result_meta`) but sends **no** `permission_denied`. An Agent starts in `default` while the terminal starts in `auto`, so a k-bench Agent asks where the terminal would not. Whether k-bench should start in the terminal's mode is a decision for #181, or for the "start" outcome.
- **#182 (hooks and quiet messages)**: the premise "a `systemMessage` may be drawn as Claude's words" is false. It is a `notice` today and would be doubled if `includeHookEvents` were turned on without changing `hookLines`. Turning the option on also adds 2 lines on every turn from the owner's own successful hooks (their stderr). So "which outputs to show" has to decide about successful hooks' stdout and stderr, not just errors. The UserPromptSubmit block is already shown, as a warning notice. A PreToolUse JSON deny's reason is visible nowhere. The drift guard has new unlisted fields: `rate_limit_info.unifiedWindows` and `informational.prompt_submit_outcome`.

## Method and rails

- Script changes on this branch: `scripts/live-check/hooks-mode.ts` (the scenarios `start-mode`, `hooks`, `denials` and their checks), `scripts/live-check/replay-177.ts` (re-judges a recording), session options for `includeHookEvents`, no `permissionMode` and a probe-only session (`session.ts`), WebFetch left offered for the deny-rule session (`rails.ts`), and redaction that keeps the check's own `KBLC` hook output and labels the owner's (`privacy.ts`).
- Rehearsed with `--fake`, then run with `--confirm` three times: run 1 used `--budget 15` and 6 turns, run 2 used `--budget 9` and 3 turns, and run 3 used `--budget 4` and 4 turns. That is **13 turns counted** by the budget, out of the cap of 15. Two of them (the blocked prompts) reached no model (`num_turns: 0`), and run 1's deny-rule turn also ran a subagent. Haiku was asserted on every `init`. The settings files were byte-identical after every run, no process was left running, and the throwaway folders were cleaned up.
- **Run 1's files were lost.** Its output folder in the shared scratchpad was overwritten by another session, so only its printed results survive. They are identical to run 3's for hooks, and only its subagent denial (`agent_id`) is not re-recorded here. Run 3's budget stopped the run on its last `result`, so its live verdicts say NOT RUN. Its complete recording was then judged by the same checks offline ([run-3/replayed.md](run-3/replayed.md): `node scripts/live-check/replay-177.ts run-3/recordings/hooks.jsonl`).
- The TUI's starting mode was read from its footer in a tmux server of the run's own, with no turn sent. The folder-trust question was answered only on "Yes, I trust this folder".
