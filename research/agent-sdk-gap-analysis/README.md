# Agent SDK gap analysis (2026-11-19)

Which capabilities of the Claude Agent SDK k-bench's Claude Agent is not well equipped to handle. The benchmark is the Agent SDK documentation at <https://code.claude.com/docs/en/agent-sdk/overview> as of 2026-11-19 (SDK 0.3.328 current; 0.3.325 installed; `claude` 2.1.328), read against k-bench `main` at `fda5daa`.

This is the source for the map [Map: Claude Agent development parity with Claude TUI](https://github.com/k-electron/k-bench/issues/175). It is a throwaway research branch and is never merged.

## How it was made

Four read-only reviews, each covering one slice of the 29 doc pages plus the installed `sdk.d.ts`, each checked against the code with `file:line` evidence:

1. [Messages and controls](1-messages-and-controls.md): every `SDKMessage` variant and `system` subtype, every `Query` method, the operator-relevant `Options`.
2. [The interaction loop](2-interaction-loop.md): approvals, questions, plan approval, elicitation, permission modes, hooks, streaming input, interrupt, result subtypes, todos.
3. [Extensions and sessions](3-extensions-and-sessions.md): resume/fork, file checkpointing, subagents, skills, plugins, MCP, output styles, custom tools.
4. [Operations](4-operations.md): startup and exit failures, usage and limits, lifecycle, hosting, security, observability.

The highest-severity claims were re-checked by hand against the code before this was written up: the 16M-character line limit (`src/agent/lines.ts:8`, `src/server/agent-sockets.ts:118`), the rate-limit reader ignoring usage-credit fields (`web/src/agent/uncommon.ts:469`), subagent messages dropped (`web/src/agent/items.ts:368`), no caller of `rewindFiles` / `forwardSubagentText` / `mcpServerStatus` / `includeHookEvents`, the Composer hidden while an ask is open (`web/src/components/agent/PromptDock.tsx:75`), no reader of `permission_denied` or `model_refusal_*`, and no `decisionReason` / `blockedPath` in the permission panel.

## Corrections on review

- Report 3's claim that `init.effort` contradicts the parity doc is wrong: the field is filled only on Remote Control bridge inits. Corrected in place.
- Report 2 rates the Task tools (`TaskCreate`/`TaskUpdate`) Medium. They are on by default only on Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier, so they don't affect the owner's usual models: Low.
- Ctrl+B (`backgroundTasks()`) was left out by the owner during the first map. The development-parity map reopens it as a question, not as a gap.

## Ranked gaps, by development outcome

The map judges every gap by the outcome it blocks. Severity is what the owner would hit in normal use.

| Outcome            | Gap                                                                                                                                                                                                                              | Severity                 | Report |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ |
| Recover            | A catch-up replay over 16M characters (screenshot or PDF heavy turns, base64 twice over) makes the relay hang up, and the browser asks for the same replay again: the Agent never loads on that device                           | High                     | 4      |
| Steer              | While any ask is open the Composer, its Interrupt and Esc are hidden: every queued ask must be answered before Claude can be stopped or redirected                                                                               | High                     | 2      |
| Approve safely     | Asks never show why they were raised (`decisionReason`, hook reason, `blockedPath`, which subagent); classifier, rule and `dontAsk` denials show a bare red Denied/Failed (`permission_denied` dropped)                          | High                     | 1, 2   |
| Stay within limits | Usage-credit (overage) fields in `rate_limit_event` are ignored: a turn billed to credits shows nothing                                                                                                                          | High (if credits are on) | 4      |
| See the work       | Subagent messages are all dropped; one task line per subagent. `forwardSubagentText` unset. Subagents run in the background by default                                                                                           | High                     | 3      |
| Review and undo    | `rewindFiles` (with `dryRun`) never called though checkpointing is on and each prompt id is the message `uuid`: restoring code needs Open in terminal                                                                            | High                     | 1, 3   |
| Use your setup     | `includeHookEvents` unset: only SessionStart/Setup hook output arrives. A hook `systemMessage` may arrive as an `is_meta` assistant message drawn as Claude's words (unconfirmed)                                                | Medium                   | 1, 2   |
| Recover            | "Recognised" kinds nothing renders are silent forever (`model_refusal_fallback` with its retracted reply, `session_writes_lost`, `memory_recall`, `plugin_install`, `thinking_tokens`)                                           | Medium                   | 1      |
| Use your setup     | MCP status read only from each turn's init; no reconnect/enable; "needs sign-in" has no action; elicitations declined before the owner can act                                                                                   | Medium                   | 3      |
| Recover            | No stderr kept; early runtime crash leaves only "exited unexpectedly"; a slow start is reported as a crash                                                                                                                       | Medium                   | 4      |
| See the work       | Stalled tools and retrying subagents look like progress (`tool_progress`, `subagent_retry` unread)                                                                                                                               | Medium                   | 4      |
| Stay within limits | Plan-usage warnings land in one Agent only; no 5-hour/weekly meter                                                                                                                                                               | Medium                   | 4      |
| Approve safely     | "Don't ask again" doesn't say which rule or where; deny never sets `interrupt` so parallel work carries on; untrusted folders run project hooks and MCP without the trust prompt                                                 | Medium                   | 2, 4   |
| Start and pick up  | No way to open an existing (terminal-started, or pre-`/clear`) conversation as an Agent; an Agent with no mode set may start in `auto` (unconfirmed)                                                                             | Medium–Low               | 1, 3   |
| —                  | Lower: MCP image/resource results, thinking text, tool-input streaming, `getContextUsage` full detail each turn, session-only effort, title sync, keyboard answers, plan-approval variants, Skill/Agent tool lines, output style | Low                      | all    |

## Out of reach by design

Program-only SDK features (structured output, `SessionStore`, in-process tools and hook callbacks as such, budget and turn caps), hosting and multi-tenant isolation, OpenTelemetry pipelines, API keys and third-party providers, the Python SDK.

## Subscription use, from the primary source

Anthropic's [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) page bars third-party developers from offering Claude.ai login or handling Claude.ai credentials, and does not prevent "an end user signing in to the unmodified Claude Code binary with their own Claude subscription". k-bench runs the owner's installed, unmodified `claude` and never reads a credential. The owner's call (2026-11-19): fine as it is. The live billing risk is the separate "Agent SDK credit" pool Anthropic announced in May 2026 and paused on 2026-06-16; Claude TUI Sessions are the hedge if it returns.
