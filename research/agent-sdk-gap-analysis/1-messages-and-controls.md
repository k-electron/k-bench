# SDK gap analysis: TypeScript SDK reference slice

**Sources checked:** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (0.3.325; `agentSdkTypes.d.ts` is a one-line stub), the fetched docs, `src/agent-runtime/*`, and `web/src/agent/{items,uncommon,unsupported,tasks}.ts`. I read the code for every claim below. I changed no files.

**Docs vs installed 0.3.325.** Everything the docs describe exists in 0.3.325. The differences all go the other way: the installed types have things the docs leave out.

- `SDKSessionWritesLostMessage` (`system/session_writes_lost`) is in the installed union (sdk.d.ts:5805) but not in the docs' union.
- `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`, the `reloadPlugins({refuseIfBusy})` option and the `setMaxThinkingTokens(…, thinkingDisplay)` second argument are installed but not documented.
- The options `onUserDialog`, `supportedDialogKinds`, `perTaskStopAffordance` and `pluginDelivery` are installed but not in the docs' Options table.
- The two sources disagree on `permissionMode` when it is omitted. The docs say the session "starts in `default`". sdk.d.ts:2112 says Claude Code picks the mode "as it does for `claude -p` … else `'auto'` where that is the default". k-bench shows whatever mode Claude Code reports, so the display is correct either way. But an Agent may start in `auto` where the TUI starts in `default`. Worth confirming in a live check.

**The runtime logs every message.** Every SDK message except `stream_event` is appended to the log unchanged (main.ts:236-243). So "logged" is yes for all rows below, and the question is only what the web UI does with each one.

**A blind spot in the drift guard.** `unsupported.ts:48-96` lists every type and subtype in 0.3.325 as "recognised". Any recognised kind that `items.ts` and `uncommon.ts` don't render is therefore silent forever. It never becomes an Unsupported row and never reaches the #154 running list. All the "Not handled" message rows below fall into that gap.

---

## 1. `SDKMessage` variants and `system` subtypes

### Partial / Not handled

| Capability                                                                                       | Status                           | Evidence                                                                                                                                                                                                                            | What the owner would see or miss                                                                                                                                                                                                                                                                                                                                                                           | Severity   |
| ------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `hook_started` / `hook_progress` / `hook_response`, together with the `includeHookEvents` option | Partial                          | session.ts:131-155 does not set `includeHookEvents` (default false, sdk.d.ts:1988). uncommon.ts:375-396 renders `hook_response`. The only recorded fixture is `SessionStart:startup` (test/harness/fixtures/uncommon-messages.json) | Without the option, Claude Code only emits SessionStart/Setup hook events (and background-hook responses). The hook line #148 built never fires for PreToolUse, PostToolUse, UserPromptSubmit or Stop hooks: a non-blocking hook error, or a hook's `systemMessage`, is invisible. A blocking failure still reaches the tool result                                                                        | **Medium** |
| `system/permission_denied` (`SDKPermissionDeniedMessage`)                                        | Not handled (recognised, silent) | unsupported.ts:85; nothing in items.ts or uncommon.ts reads it                                                                                                                                                                      | Denials by the auto-mode classifier, `dontAsk` or a deny rule carry `decision_reason_type` and `decision_reason`, and none of it is shown. The tool card goes red as **Failed** with the rejection text, unless the unconfirmed `tool_result_meta.permission_decision` path (items.ts:282-292) catches it. With `auto` in the mode cycle, the owner can't see that the classifier blocked something or why | **Medium** |
| `system/model_refusal_fallback`                                                                  | Not handled                      | unsupported.ts:92; no reader                                                                                                                                                                                                        | The SDK says to evict `retracted_message_uuids` from the transcript. k-bench never does, so the refused partial reply stays on screen next to the retry. The switch to `fallback_model` for the session isn't announced; the header only changes at the next `init`. Category and explanation are lost                                                                                                     | **Medium** |
| `system/model_refusal_no_fallback`                                                               | Not handled                      | unsupported.ts:93                                                                                                                                                                                                                   | A refusal with no retry is only shown if the assistant frame also carries `error` (uncommon.ts:550-556). `api_refusal_explanation` is never shown                                                                                                                                                                                                                                                          | Low–Med    |
| `system/session_writes_lost`                                                                     | Not handled                      | unsupported.ts:88                                                                                                                                                                                                                   | The disk is full, so Claude Code's transcript lost lines. Restart, Open in terminal and Open in web (which all resume that transcript) may then silently miss turns that k-bench's own log still shows                                                                                                                                                                                                     | Low        |
| `system/memory_recall`                                                                           | Not handled                      | unsupported.ts:91                                                                                                                                                                                                                   | No "Recalled from memory" line, so the owner can't see which memories steered a turn                                                                                                                                                                                                                                                                                                                       | Low        |
| `tool_progress`                                                                                  | Partial                          | runtime: activity.ts:13 (turn start only); UI: no reader                                                                                                                                                                            | No elapsed time on a running tool (the TUI shows `(12s)`). `subagent_retry` (a subagent's API retries) is ignored. Every heartbeat is also logged and makes the browser rebuild its items                                                                                                                                                                                                                  | Low        |
| `system/thinking_tokens`                                                                         | Not handled                      | unsupported.ts:94                                                                                                                                                                                                                   | No "thinking ↓ 1.2k tokens" progress. Also logged on every frame                                                                                                                                                                                                                                                                                                                                           | Low        |
| `auth_status`                                                                                    | Not handled                      | unsupported.ts:56                                                                                                                                                                                                                   | Authentication in progress and its `error` are not shown (an `authentication_failed` assistant error still is)                                                                                                                                                                                                                                                                                             | Low        |
| `tool_use_summary`                                                                               | Not handled                      | unsupported.ts:55                                                                                                                                                                                                                   | Claude Code's one-line summaries of tool batches are dropped                                                                                                                                                                                                                                                                                                                                               | Low        |
| `system/plugin_install`, and `init.plugin_errors`                                                | Not handled                      | unsupported.ts:84; `plugin_errors` is never read (grep finds none)                                                                                                                                                                  | A plugin that failed to install or load is invisible. In the terminal it would be reported                                                                                                                                                                                                                                                                                                                 | Low        |
| `result` fields: `permission_denials`, `terminal_reason`, `total_cost_usd`, `api_error_status`   | Partial                          | uncommon.ts:516-536 reads only `is_error`, `subtype`, `result` and `errors`                                                                                                                                                         | Error results show their text. A _successful_ result with `terminal_reason` such as `stop_hook_prevented`, `blocking_limit` or `prompt_too_long` says nothing. Denials listed in the authoritative `permission_denials` are not shown                                                                                                                                                                      | Low        |

### N/A for an operator

| Capability                        | Status | Why                                                                              |
| --------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `system/files_persisted`          | N/A    | Only for remote file uploads                                                     |
| `system/mirror_error`             | N/A    | Needs `sessionStore`, which k-bench doesn't set                                  |
| `system/worker_shutting_down`     | N/A    | Bridge and remote workers only                                                   |
| `system/control_request_progress` | N/A    | Only for `side_question`, which k-bench never sends                              |
| `prompt_suggestion`               | N/A    | Needs `promptSuggestions`, which is off; the parity doc lists it as out of scope |

### Handled (one line each)

- `assistant`: prose, thinking, tools, `error`, `<synthetic>` command output (items.ts:415-483; uncommon.ts:550).
- `user` and `SDKUserMessageReplay`: tool results, echoes, interrupts, compact summaries (items.ts:484-561).
- `result`: ends running tools; error line (items.ts:562; uncommon.ts:578).
- `stream_event`: live text plus snapshot (main.ts:236-242; live.ts).
- `system/init`: model, cwd, MCP failed/needs-auth, terminal-only commands, view mode (items.ts:384-400; uncommon.ts:366).
- `system/status`: compacting, compact_result and permission mode (uncommon.ts:369; mode.ts:59).
- `compact_boundary` (uncommon.ts:372).
- `api_retry` (uncommon.ts:407).
- `local_command_output` (items.ts:401).
- `task_started`, `task_progress`, `task_updated`, `task_notification` and `background_tasks_changed` (tasks.ts; web/src/agent/tasks.ts:64).
- `session_state_changed` (activity.ts:80).
- `commands_changed` (commands.ts:77).
- `notification` and `informational`: loud ones shown, quiet ones dropped by design (uncommon.ts:439).
- `rate_limit_event`: warning and rejected (uncommon.ts:469).
- `elicitation_complete` (uncommon.ts:397).
- `conversation_reset`: divider (uncommon.ts:568).
- `command_lifecycle`, `active_goal` and `keep_alive` are not in the SDK types but are recognised (prompts.ts:25).

---

## 2. `Query` control methods

k-bench calls `initializationResult`, `accountInfo`, `supportedCommands`, `setPermissionMode`, `getContextUsage`, `interrupt`, `stopTask` and `close` (session.ts:169-260). Prompts go in through the `prompt` AsyncIterable, which does the same job as `streamInput`. Nothing else is called.

### Not handled / Partial

| Capability                                                                                      | Status                                                | Evidence                                                                                                                                  | What the owner would miss                                                                                                                                                                                                                                        | Severity   |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `rewindFiles(userMessageId, {dryRun})`                                                          | Not handled                                           | Checkpointing is on (session.ts:138) but nothing calls the method. k-bench's prompt `id` already _is_ the message `uuid` (session.ts:231) | "Restore code to before this prompt", with a dry-run preview of the files that would change, could sit on each prompt row. Today the only way is Open in terminal → `/rewind`, which stops the Agent. That hurts most on a phone                                 | **Medium** |
| `backgroundTasks(toolUseId?)` (the terminal's Ctrl+B)                                           | Not handled                                           | not called; no protocol message; the parity doc has no row for it                                                                         | A long foreground `Bash` (a test run, a build) or a blocking subagent can only be waited out or Interrupted. The terminal can push it to the background and keep the turn going. The machinery to show and Stop it afterwards already exists (#149)              | **Medium** |
| `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()`                                | Not handled                                           | not called. MCP state is read only from each turn's `init.mcp_servers` (uncommon.ts:326-360)                                              | A failed server is shown, but the only fix is Open in terminal → `/mcp`. A server that fails after `init`, or comes up later, is unseen until the next turn. Reconnect and enable/disable are one call each. OAuth sign-in has no public method                  | Low–Med    |
| `interrupt()` receipt (`still_queued`)                                                          | Partial                                               | the result is discarded (session.ts:241)                                                                                                  | Not needed, since "(queued)" comes from `command_lifecycle`. The terminal's "take back a queued message" is documented through `cancel_queued` on the raw control request, which `interrupt()` never sends, so the parity doc's "no public method" holds         | Low        |
| `getContextUsage({detail})`                                                                     | Partial                                               | called with no options after every turn (main.ts:158-168; session.ts:210)                                                                 | The default `'full'` runs per-category token-count API calls after **every** turn, and k-bench only uses four totals. `{detail: 'summary'}` (already in 0.3.325) would answer from local data                                                                    | Low        |
| `setModel()`, `supportedModels()`, `setMaxThinkingTokens()`, `applyFlagSettings({effortLevel})` | Not handled (typed `/model` and `/effort` cover them) | —                                                                                                                                         | There is no session-only model or effort change from the UI. `updateSettings`' own JSDoc says typed `/effort` **saves to user settings**, so these methods are the only route that changes effort for this session alone (as the Launch option does for advisor) | Low        |
| `supportedAgents()`                                                                             | Not handled                                           | —                                                                                                                                         | No list of subagents (the parity doc's `/agents` row is Open in terminal)                                                                                                                                                                                        | Low        |
| `usage_EXPERIMENTAL_…()`                                                                        | Not handled                                           | —                                                                                                                                         | Plan-usage windows (5-hour, 7-day) could sit in the status line. It is experimental, so better not to depend on it                                                                                                                                               | Low        |
| `readMcpResource()` (MCP Apps widgets)                                                          | Not handled                                           | —                                                                                                                                         | `ui://` widgets are never rendered. Alpha                                                                                                                                                                                                                        | Low        |

**Present at runtime but hidden from the public types.** sdk.mjs has `askSideQuestion` (`/btw`), `cancelAsyncMessage` (take back a queued message), `listPermissionRules`, `getHooksListing`, `renameSession` and `getTaskOutput`. The parity doc marks several of those rows "No public SDK API". That is correct for the public types, but the capability exists inside. I would not build on these, since they could change in any release.

### N/A for an operator

- `reinitialize()`: stdio has no transport gap.
- `setMcpServers()`, `setMcpPermissionModeOverride()`: MCP servers come from the owner's settings.
- `reloadPlugins()`, `reloadSkills()`, `reloadOutputStyles()`: typed `/reload-*` already works.
- `readFile()`: the `@` picker uses its own server.
- `seedReadState()`.

### Handled (one line each)

- `interrupt` (plain, so queued prompts survive).
- `stopTask`.
- `setPermissionMode`, including the refused-`auto` fallback (main.ts:310-322).
- `initializationResult`: version, mode, models.
- `accountInfo`: the subscription-only check.
- `supportedCommands`: the `/` menu.
- `getContextUsage`: the status line.
- `close`.
- `streamInput`: done through the prompt AsyncIterable.

---

## 3. `Options` fields (set in session.ts:131-155 and 60-84)

**Set:** `pathToClaudeCodeExecutable`, `cwd`, `systemPrompt` preset, `includePartialMessages`, `enableFileCheckpointing`, `canUseTool`, `perTaskStopAffordance`, `onElicitation`, `model`/`effort` (Launch options), `extraArgs` (`replay-user-messages`, `advisor`), `env` (plus `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`), `settings: {viewMode}`, and `resume`/`sessionId`.

**Not set** (I grepped `src/agent-runtime` for each): every other option, including `includeHookEvents`, `forwardSubagentText`, `permissionMode`, `settingSources`, `toolConfig`, `title`, `additionalDirectories`, `maxTurns`, `maxBudgetUsd`, `hooks`, `agents`, `plugins`, `sandbox`, `persistSession`, `forkSession`, `resumeSessionAt`, `supportedDialogKinds` and `onUserDialog`.

### Partial / Not handled

| Capability                                            | Status                                  | Evidence                                       | What setting it differently would change                                                                                                                                                                                                            | Severity   |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `includeHookEvents`                                   | Not set                                 | session.ts:131-155                             | `true` sends every hook's lifecycle events, so uncommon.ts's hook line works for PreToolUse, PostToolUse and Stop as in the terminal (see §1)                                                                                                       | **Medium** |
| `onElicitation`                                       | Partial: always declines                | session.ts:146-149; items.ts:681-686           | `ElicitationRequest.mode === 'url'` is just a message and a link, which is easy to show on the web. Simple `form` schemas could be a small form. The decline is final, so Open in terminal afterwards can't answer it; Claude has to be asked again | Medium     |
| `forwardSubagentText`                                 | Not set                                 | items.ts:368 also hides every subagent message | Off means the text and thinking of a foreground subagent are never sent. Turning it on would let the owner open a subagent's own transcript (the terminal does this with Ctrl+O), at the cost of a bigger log                                       | Low–Med    |
| `onUserDialog` / `supportedDialogKinds`               | Not set (deliberate, internals doc:336) | —                                              | `refusal_fallback_prompt` falls back to the plain refusal error. That is fine, provided the refusal messages in §1 are shown                                                                                                                        | Low        |
| `toolConfig.askUserQuestion.previewFormat`            | Not set                                 | no `preview` handling in the question panel    | Claude never emits option previews, so the terminal's side-by-side previews for questions are missing                                                                                                                                               | Low        |
| `title`                                               | Not set                                 | —                                              | The k-bench Session name could become the conversation title in the terminal's `/resume` list                                                                                                                                                       | Low        |
| `resumeSessionAt` / `forkSession` / `resumeDropsTurn` | Not set                                 | —                                              | The only route to a conversation rewind or branch. k-bench's log only ever grows, so this would be a design change. The parity doc already marks it out of scope                                                                                    | Low        |
| `agentProgressSummaries`                              | Not set (deliberate, internals doc:128) | —                                              | Model-written status per subagent, at extra cost on the owner's subscription                                                                                                                                                                        | Low        |

### N/A for an operator

These come from the owner's settings or are for building custom agents: `allowedTools`, `disallowedTools`, `tools`, `toolAliases`, `agents`, `agent`, `mcpServers`, `strictMcpConfig`, `plugins`, `pluginDelivery`, `hooks` (callbacks), `sandbox`, `managedSettings`, `skills`, `settingSources` (left at all sources, which is right), `permissionPromptToolName` and `permissionPrompts` (`canUseTool` is the surface), `allowDangerouslySkipPermissions`, `maxTurns`, `maxBudgetUsd`, `taskBudget`, `outputFormat`, `fallbackModel`, `verbatimPrompts` (must stay off so `@path` and `/cmd` expand), `persistSession` (must stay true), `sessionStore`, `spawnClaudeCodeProcess`, `executable`, `debug` and `stderr` (the SDK already puts the stderr tail in the exit error), `thinking`/`maxThinkingTokens`, `promptSuggestions`, `projectConfigRoot`, `additionalDirectories` (parity: `/add-dir` out of scope) and `planModeInstructions`.

### Handled (one line each)

- `canUseTool`, with no `defer`.
- `includePartialMessages`.
- `enableFileCheckpointing`, on from the first launch.
- `perTaskStopAffordance`.
- `systemPrompt` preset.
- `settingSources` left unset, which loads all sources.
- `model` and `effort` from Launch options.
- `settings.viewMode`.
- `extraArgs` advisor and replay.
- `env`.
- `resume`/`sessionId`.
- `permissionMode` left unset, with the actual mode read back from Claude Code.

---

## The 5 most important gaps in this slice

1. **Hook output is mostly off (`includeHookEvents` is unset).** Claude Code only emits SessionStart/Setup hook events by default, so the hook line #148 built never fires for the owner's PreToolUse, PostToolUse or Stop hooks. Setting one option makes non-blocking hook errors and `systemMessage`s show as they do in the terminal.
2. **No code rewind from the web, though everything is in place.** File checkpointing is on and each prompt's `id` is already the message `uuid`, yet `rewindFiles()` (with a `dryRun` preview) is never called. Restoring code still means Open in terminal → `/rewind`, which stops the Agent and is awkward on a phone.
3. **Permission denials and refusals are silent, and the drift guard can't see them.** `permission_denied` (the auto-mode classifier, rules, `dontAsk`) and `model_refusal_fallback`/`_no_fallback` are listed as recognised, so they never become Unsupported rows, yet nothing renders them. Classifier blocks show as a generic red "Failed", and a fallback leaves the retracted partial reply on screen.
4. **No Ctrl+B (`backgroundTasks()`).** A long foreground Bash command or blocking subagent can only be waited out or Interrupted, while the terminal can push it to the background and carry on. The Transcript already shows background tasks with their own Stop button, and the parity doc has no row for this.
5. **MCP elicitations are always declined, and MCP servers have no controls.** URL-mode elicitations, which are just a link, are declined for good, so Open in terminal can't answer them afterwards. A failed MCP server is shown, but `reconnectMcpServer` and `toggleMcpServer` are never offered, so the only fix is to leave for the terminal.
