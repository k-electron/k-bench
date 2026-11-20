# Agent SDK capability inventory (2026-11-20)

Which Agent SDK capabilities serve which development outcome, and how a Claude Agent reaches each one today. This answers [#176](https://github.com/k-electron/k-bench/issues/176) on the map [Map: Claude Agent development parity with Claude TUI](https://github.com/k-electron/k-bench/issues/175). It is a throwaway research branch and is never merged.

The deliverable is [the draft SDK section](draft-sdk-section.md) for `docs/claude-agent-parity.md`: one row per capability, in the checklist's style, sorted into Claude Agent, Config, Gap or Out of scope, with the outcome each serves.

## Sources

- The Agent SDK documentation as of 2026-11-19 (SDK 0.3.328): the TypeScript reference and the 28 guide pages, from the index at <https://code.claude.com/docs/llms.txt>.
- The installed types, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and `sdk-tools.d.ts` (0.3.325). The `Options` fields, `Query` methods, exported functions, the `SDKMessage` union (`sdk.d.ts:5805`) and the `Settings` keys (`sdk.d.ts:7341-9965`, used to confirm each config route) were listed from the file, not from the docs.
- k-bench `main` at `fda5daa`: `src/agent-runtime/`, `src/agent/`, `web/src/agent/`, `web/src/components/agent/`, `web/src/components/NewSessionDialog.tsx`. Every Claude Agent row was checked by reading the cited lines.
- The four reviews and ranked table on `research/agent-sdk-gap-analysis`, with its README's corrections applied (`init.effort` is bridge-only; the Task tools are Low).

## The answer in numbers

192 rows. Rows group capabilities that always go together (the four `task_*` subtypes, `debug` and `debugFile`), so they cover all 69 installed options plus the docs-only `outputStyle`, all 30 `Query` methods, all 21 exported functions plus `InMemorySessionStore` and `AbortError`, all 40 message types (11 top-level, 29 `system` subtypes), and the guide pages' features.

| Where        | Options | Query methods | Functions | Messages | Guide features | Total |
| :----------- | ------: | ------------: | --------: | -------: | -------------: | ----: |
| Claude Agent |      15 |            13 |         2 |       17 |             12 |    59 |
| Config       |      14 |             2 |         0 |        0 |             11 |    27 |
| Gap          |       8 |             6 |         4 |       12 |             12 |    42 |
| Out of scope |      28 |             8 |         9 |        5 |             14 |    64 |

The 42 Gap rows by ticket: #182 11, #184 6, #185 5, #189 4, #181 3, #187 3, #186 2, #190 2, #180 1, #183 1, #188 1, and 3 that no ticket covers (below). Every gap the map already charted has a ticket; the inventory found no high-severity gap the gap analysis missed.

"Out of scope" here holds three kinds of reason: program-only (most of them), out by a standing decision of this map or the first one, and no outcome needs it (the fog items that did not earn a place, `toolConfig`, `supportedAgents()`). The Notes say which.

## Gaps not on the map

None of #177–#190 covers these, and they were not in the map's fog:

1. **A successful turn that ended for a reason says nothing** (Recover). `readResult` shows only error results (`web/src/agent/uncommon.ts:515-534`). A `success` result whose `terminal_reason` is `prompt_too_long`, `blocking_limit`, `stop_hook_prevented` or `tool_deferred` (a PreToolUse hook deferring a call), or whose `stop_reason` is `refusal` or `max_tokens`, ends with no line, so the failure can't be explained. GA1 §1 result fields, GA2 #7 and #15 list it, but no ticket took it. It fits #182 as one more quiet message.
2. **Redirect without killing running work: `priority: 'now'` with `origin: {kind: 'human'}`** (Steer). The streaming-input guide documents that such a message moves running shell commands and subagents to the background and is read in the same turn (Claude Code 2.1.286 or later). k-bench sends every prompt with no `priority` (`src/agent-runtime/session.ts:226-233`), so a redirect waits for the running tool calls to finish or Interrupt kills them. This is a second route for #188's question (keeping a long build going) and an input to #179 (redirecting at any moment). If adopted, a WebFetch or WebSearch it detaches (`detachedToolCall`) must stop showing as done (GA2 #17), which only happens after a `'now'` message.
3. **The Task tools are not a checklist** (See the work). Only `TodoWrite` becomes one (`uncommon.ts:592,709`). On Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier, Claude Code's default is `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`, which show as plain tool lines, so the parity row "The task list (TodoWrite) as a checklist" holds only on newer models or with `CLAUDE_CODE_ENABLE_TASKS=0`. GA2 #6, Low after review. One line for #185.

Smaller additions to existing tickets, found while sorting:

- **#184**: an MCP result too large for Claude Code, which saves it to a file and returns an error naming it, shows as a red Failed tool (GA3 #9). #184 names images and resources but not this.
- **#190**: `debug`/`debugFile` is a candidate beside the `stderr` callback for what an Agent keeps.
- **#185**: `getSubagentMessages()`/`listSubagents()` can feed a drill-in view from Claude Code's own files instead of k-bench's log.

Considered and left out: memory growth in a long-running Claude Code (GA4 #6, hosting § Known limitations). Nothing measures it and a Restart resumes, so no outcome is blocked yet.

## The lower-severity gaps (the map's fog), sorted

| Fog item                                 | Outcome            | Earns a place?                                                                                                                                                                                                                                                                                                                                                                                |
| :--------------------------------------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP image and resource results           | Use your setup     | Yes, already in #184. A screenshot from a browser MCP server is part of the work on a phone.                                                                                                                                                                                                                                                                                                  |
| Claude's thinking text                   | See the work       | No. The raw view reaches it, which is where the terminal keeps it too (its transcript view), and the `showThinkingSummaries` setting decides whether there is any text to show.                                                                                                                                                                                                               |
| Tool input streaming                     | See the work       | Yes, one line in #185 ("how stuck work looks"). A long Write shows nothing until it is generated; the tool's name from `content_block_start` is enough, without streaming its input.                                                                                                                                                                                                          |
| `getContextUsage` full detail every turn | Stay within limits | Yes, already in #183. One line: ask for `{detail: 'summary'}`, which answers from local data.                                                                                                                                                                                                                                                                                                 |
| A session-only effort change             | Start and pick up  | No. The Effort Launch option sets the session's effort, and a typed `/effort` saves to settings exactly as the terminal's does (`sdk.d.ts:3137-3147`: `updateSettings` saves effort "as /effort saves it").                                                                                                                                                                                   |
| Session title sync                       | Start and pick up  | Yes, already in #189.                                                                                                                                                                                                                                                                                                                                                                         |
| Keyboard answers for asks                | Approve safely     | No. A desktop nicety, welcome but not required. Esc with an ask open belongs to #179.                                                                                                                                                                                                                                                                                                         |
| Plan-approval variants                   | Approve safely     | Yes, one line in #181. Approving returns to the mode before plan mode (`src/agent-runtime/mode.ts:12`), which may be Accept edits or Auto, so approval can start unattended edits the panel never mentions. The panel should say which mode follows, and offer the terminal's "approve and accept edits" against "approve and ask". Editing the plan stays out (approving with edited input). |
| The Skill and Agent tool lines           | See the work       | Yes, one line in #185: name the skill and the subagent type (`subagent_type`), which `toolTarget` skips (`web/src/agent/toolDisplay.ts:79-83`).                                                                                                                                                                                                                                               |
| The output style                         | Use your setup     | No. It applies from settings as in the terminal, whose screen doesn't show it either.                                                                                                                                                                                                                                                                                                         |

Six earn a place: three already in their tickets (#183, #184, #189) and three as one-line additions (#181 once, #185 twice). Four don't.

## Docs against the installed types

- The docs (0.3.328) describe nothing missing from the installed 0.3.325.
- Installed only: the options `onUserDialog`, `supportedDialogKinds`, `perTaskStopAffordance` and `pluginDelivery`; `usage_EXPERIMENTAL_…()`; the functions `archiveSession`, `unarchiveSession`, `importSessionToStore` and `filterEscalatingDefaultMode`; the message `system/session_writes_lost`.
- Docs only: `outputStyle` appears in the Options table to say it is not an option; it is a setting.
- Runtime-only methods outside the public types (`askSideQuestion`, `cancelAsyncMessage`, `listPermissionRules` and others, GA1 §2) have no rows: the checklist tracks the public surface.

## Limits of this pass

- Read-only. Nothing was run against a real `claude`; claims about what Claude Code sends are from the types and docs, and #177 and #178 check the uncertain ones.
- "Config" rows name a settings key or environment variable confirmed in the installed `Settings` type or the docs; whether each behaves identically in an SDK session was not tested.
