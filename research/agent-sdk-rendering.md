# What the Agent SDK gives a client for rendering and catching up on a conversation

Research for issue 104 on map issue 102. Facts only; product decisions belong to later tickets.

**Inspected:** `@anthropic-ai/claude-agent-sdk` 0.3.319, which declares `claudeCodeVersion` 2.1.319 in its `package.json`. Read on 2026-11-08 from its `sdk.d.ts`, `sdk-tools.d.ts`, `browser-sdk.d.ts` and, where noted, its bundled `sdk.mjs`. Nothing from the package was executed, and no spike was run, so no behaviour below was observed live.

**Evidence labels:** _Documented_ means stated by Anthropic docs, type comments or the changelog. _Bundled code_ means read from minified `sdk.mjs` 0.3.319 and able to change without notice. _Inference_ is my reasoning from those. _Unconfirmed_ means I could not establish it.

## Sources

| Key           | Source                                                                             |
| :------------ | :--------------------------------------------------------------------------------- |
| [types]       | `sdk.d.ts` in the npm package, 0.3.319                                             |
| [tools]       | `sdk-tools.d.ts` in the npm package, 0.3.319                                       |
| [browser]     | `browser-sdk.d.ts` in the npm package, 0.3.319                                     |
| [bundle]      | `sdk.mjs` in the npm package, 0.3.319                                              |
| [changelog]   | <https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md> |
| [ts-ref]      | <https://code.claude.com/docs/en/agent-sdk/typescript>                             |
| [streaming]   | <https://code.claude.com/docs/en/agent-sdk/streaming-output>                       |
| [input-modes] | <https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode>               |
| [loop]        | <https://code.claude.com/docs/en/agent-sdk/agent-loop>                             |
| [sessions]    | <https://code.claude.com/docs/en/agent-sdk/sessions>                               |
| [store]       | <https://code.claude.com/docs/en/agent-sdk/session-storage>                        |
| [user-input]  | <https://code.claude.com/docs/en/agent-sdk/user-input>                             |
| [permissions] | <https://code.claude.com/docs/en/agent-sdk/permissions>                            |
| [sdk-hooks]   | <https://code.claude.com/docs/en/agent-sdk/hooks>                                  |
| [hooks]       | <https://code.claude.com/docs/en/hooks>                                            |
| [cli]         | <https://code.claude.com/docs/en/cli-reference>                                    |
| [env]         | <https://code.claude.com/docs/en/env-vars>                                         |
| [vision]      | <https://platform.claude.com/docs/en/build-with-claude/vision>                     |

## 1. Message and partial-message shapes

`SDKMessage` is a union of 40 members [types]. The docs page lists 39 and lacks `SDKSessionWritesLostMessage`, added in 0.3.317 [ts-ref] [changelog]. Members carry `session_id` and `uuid`; on `SDKUserMessage` both are optional [types].

### Conversation content

| `type`                       | TS type                                | What it carries                                                                                                                                                                                                                                 |
| :--------------------------- | :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant`                  | `SDKAssistantMessage`                  | `message: BetaMessage`, `parent_tool_use_id`, `uuid`, optional `error`, `aborted`, `supersedes`, `agent_id`, `timestamp`, `user_message_uuid(s)`, `resume_reason`                                                                               |
| `user`                       | `SDKUserMessage`                       | `message: MessageParam` with text, image, document or `tool_result` blocks; `tool_use_result`; `isSynthetic`; `priority`; `origin`; optional `uuid`                                                                                             |
| `user` with `isReplay: true` | `SDKUserMessageReplay`                 | Required `uuid`; `file_attachments`; otherwise as above                                                                                                                                                                                         |
| `stream_event`               | `SDKPartialAssistantMessage`           | `event: BetaRawMessageStreamEvent`, `uuid`, `ttft_ms`, `user_message_uuid(s)`, `resume_reason`                                                                                                                                                  |
| `result`                     | `SDKResultSuccess` or `SDKResultError` | Subtype `success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`; `stop_reason`, `terminal_reason`, `permission_denials`, `deferred_tool_use`, `queued_turn_count`, cost and usage |
| `conversation_reset`         | `SDKConversationResetMessage`          | `new_conversation_id`, `trigger`; "should mount a fresh transcript", and reset on every such frame                                                                                                                                              |
| `tool_use_summary`           | `SDKToolUseSummaryMessage`             | `summary`, `preceding_tool_use_ids`                                                                                                                                                                                                             |

All from [types] and [ts-ref].

### `system` subtypes and other live signals

From [types], grouped for reading:

- **Session and status:** `init`, `status`, `session_state_changed`, `worker_shutting_down`, `informational`, `notification`, `compact_boundary`, `commands_changed`, `local_command_output`, `memory_recall`, `plugin_install`, `session_writes_lost`, `mirror_error`, `files_persisted`.
- **API and model:** `api_retry`, `thinking_tokens`, `model_refusal_fallback`, `model_refusal_no_fallback`, `control_request_progress`.
- **Hooks:** `hook_started`, `hook_progress`, `hook_response`.
- **Background tasks:** `task_started`, `task_updated`, `task_progress`, `task_notification`, `background_tasks_changed`.
- **Permissions and MCP:** `permission_denied`, `elicitation_complete`.

Top-level types that are not `system`: `tool_progress`, `auth_status`, `rate_limit_event`, `prompt_suggestion` [types].

`session_state_changed` (`idle`, `running`, `requires_action`) is only emitted with `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` [env]. The changelog says `command_lifecycle` frames were added in 0.3.206, but no such member is in the 0.3.319 union [changelog] [types]. Whether they still reach a TS consumer is unconfirmed.

### How one response arrives

- By default the SDK yields one complete `AssistantMessage` per non-empty content block. "Both share the same message ID", read as `message.message.id` [streaming]. Each frame has its own `uuid` and `stop_reason` is typically still null [types].
- `includePartialMessages: true` adds `stream_event` frames wrapping raw API events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` [streaming] [types]. `ping` frames also occur and can be read as liveness [ts-ref].
- Documented order: each `AssistantMessage` arrives **before** that block's `content_block_stop` [streaming].
- Text arrives as `text_delta`, tool input as `input_json_delta`, and accumulation is the client's job [streaming]. Other delta types come from the API's event definition and were not enumerated here.
- A cut-off stream still gets `message_stop` from Claude Code v2.1.290, but `content_block_stop` and `message_delta` can be missing. If a tool block is still open at `message_stop`, "treat that call's input as incomplete" [streaming].
- An interrupted message carries `aborted: true` and may end mid-word [types].
- `supersedes` and `retracted_message_uuids` tell a client to evict frames already delivered, after a refusal fallback [types].
- `stream_event.parent_tool_use_id` is always `null`, because subagent deltas are not forwarded. Subagents appear as complete messages, by default only `tool_use` and `tool_result` blocks. `forwardSubagentText` adds their text and thinking [streaming] [types].
- Match subagent messages to task events on `agent_id`, not `parent_tool_use_id`, because the latter stops matching after a subagent resume [ts-ref].
- Tool results arrive as `user` messages. `tool_use_result` holds the tool's structured output, keyed by tool name; types are in [tools] [loop] [types].
- A few system events can follow `result`, so iterate to completion [loop].
- User messages are only echoed with `--replay-user-messages` [cli]. It is not a typed option on `Options`; the route would be `extraArgs` [types], which is inference.

## 2. `getSessionMessages` and friends

| Function                                                                            | Returns                                |
| :---------------------------------------------------------------------------------- | :------------------------------------- |
| `getSessionMessages(id, {dir, limit, offset, includeSystemMessages, sessionStore})` | `SessionMessage[]`, empty if not found |
| `getSubagentMessages(id, agentId, opts)`                                            | `SessionMessage[]`                     |
| `listSubagents(id, opts)`                                                           | `string[]`                             |
| `listSessions(opts)`                                                                | `SDKSessionInfo[]`                     |
| `getSessionInfo(id, opts)`                                                          | `SDKSessionInfo` or undefined          |

`SessionMessage` is `{ type: 'user' | 'assistant' | 'system', uuid, session_id, message: unknown, parent_tool_use_id, parent_agent_id }` [types] [ts-ref].

**What it returns (documented):**

- It "builds the conversation chain via parentUuid links, and returns user/assistant messages in chronological order" [types].
- System messages, such as compact boundaries, need `includeSystemMessages: true` [types] [ts-ref].
- After compaction it returns the post-compaction chain, "the linked message chain the agent would see on resume". The docs' example is 503 raw entries returning 18 messages. For pre-compaction history they name only `store.load(key)`, for a `SessionStore` user [store].
- Paging is `limit` and `offset` from the start. There is no cursor, "since" parameter or tail read [types].
- `SDKSessionInfo` has no running or idle field [ts-ref].

**Tool results:** they come back in `user` messages; 0.2.80 fixed dropped parallel results [changelog]. The live `tool_use_result` structured output is **not** in `SessionMessage`, and the bundled mapper does not copy it [types] [bundle]. So a history view has only the model-facing `tool_result` content. _Bundled code._

**Images:** `message` is passed through from the transcript unchanged [bundle], so whatever the transcript holds is what comes back. Docs do not say how images are stored. User-filed issues on Anthropic's repos describe base64 inside transcripts ([claude-code #80175](https://github.com/anthropics/claude-code/issues/80175), closed; [SDK #492](https://github.com/anthropics/claude-agent-sdk-typescript/issues/492), open). Treat that as low-trust corroboration. Whether every image type is retained is unconfirmed.

**A turn still in progress:** no document describes this, and the docs call the source a "past session transcript" [ts-ref].

- The changelog shows mid-turn reads are expected to return real data: 0.3.274 and 0.3.275 made messages sent while Claude worked appear "where Claude read it", and 0.3.285 covered a process that stopped before the reply [changelog].
- 0.3.275 fixed "sometimes missing a turn's assistant message when called right after the turn's `result` message" [changelog]. _Inference:_ the on-disk transcript can lag the live stream.
- The store-path reader keeps only `user`, `assistant`, `progress`, `system` and `attachment` entries [bundle], so no `stream_event` data comes back. _Inference:_ a block still being generated is absent, and a partly streamed reply is not recoverable from history. The file-path reader was not traced.
- The result has no marker that a turn is unfinished. An unanswered `tool_use` at the tail is possible, but that shape is unconfirmed.

**Undocumented runtime fields:** the 0.3.319 mapper also adds `timestamp`, `is_meta`, `isCompactSummary`, `isQueuedCommand`, `isCompletedLocalCommand`, `interruptedByShutdown`, `toolDenialUnanswered` and `origin`, none of them in the type. It drops meta, sidechain and team entries, with an origin-based exception for meta [bundle]. _Bundled code; not a contract._

Sessions live as JSONL at a documented path, and the docs also present `getSessionMessages` as the way to build "transcript viewers" [sessions].

## 3. Stitching history and live messages

**Plain answer: there is no documented, gap-free way to do this on the local transport.** The pieces that exist:

| Identifier                       | Status                                                                                                                                                                              |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript `uuid`                | "Most entries carry a stable `uuid`"; documented as a `SessionStore` idempotency key [types]                                                                                        |
| `SessionMessage.uuid`            | "Unique message identifier" [ts-ref]                                                                                                                                                |
| Client-set `SDKUserMessage.uuid` | Documented as valid for `forkSession({upToMessageId})` alongside `SessionMessage.uuid`, so it names a transcript position [types] [ts-ref]. Replays carry a required `uuid` [types] |
| `user_message_uuid(s)`           | Binds a reply to the send it answers, but is stamped only on certain frames; merged sends produce a list [types] [ts-ref]                                                           |
| `message.message.id`             | Shared by all blocks of one API response in live frames [streaming]                                                                                                                 |
| `tool_use_id`                    | API-assigned and present in both streams. _Inference:_ a stable key for tool calls                                                                                                  |
| `timestamp`                      | "for display only; do not order messages by this field" [types]                                                                                                                     |

**Unconfirmed, and the key gap:** that a live `SDKAssistantMessage.uuid` equals the `uuid` of the corresponding entry from `getSessionMessages`. No source states it. The SDK package does not contain the code that writes transcripts. A type comment distinguishes a message's "own uuid" from "a per-block normalized uuid", which is a reason not to assume equality [types]. Also unconfirmed: whether the transcript stores one entry per block, as live frames do.

Other constraints:

- `stream_event` frames are not persisted (see section 2), so token-level catch-up cannot come from history.
- `Query` is a single async iterable. There is no documented "replay from" for a local session [types].
- The hosted `sse` transport does have this: `sequence_num`, `fromSequenceNum`, `getSseLastSequenceNum`, `catch_up_truncated` [browser]. It addresses a remote session event API, and even there `stream_event` frames are "unsequenced ephemerals". It does not apply to a local stdio session.
- `reinitialize()`'s comment assumes a host "whose ring buffer evicted frames" [types]. _Inference:_ any ring buffer of live frames is the host's to build.
- Things that change a list a client has already rendered: compaction, `conversation_reset`, `supersedes` and rewinds. 0.3.283 fixed a rewound branch being returned [changelog]. Offsets are not stable across compaction (_inference_).
- `session_writes_lost` reports transcript lines lost to a full disk [types].

## 4. Image content blocks

**Input shape** [input-modes]:

```json
{
  "type": "image",
  "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" }
}
```

- Images go in `message.content` of a streamed `SDKUserMessage`. `pasted_content` ignores non-text blocks [types].
- Single-message (string prompt) input does "**not** support" direct image attachments [input-modes].
- A block with a missing or non-object `source` raises no error. Claude Code substitutes a text note and the session continues [input-modes].
- The docs show only `base64` sources for the SDK. The API also accepts `url` and Files API `file_id` [vision]. Whether Claude Code passes those through is unconfirmed.

**Limits, from the API docs** [vision]:

| Limit                            | Value                                                                                                                                 |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| Formats                          | JPEG, PNG, GIF, WebP; animations use the first frame only                                                                             |
| Size per image                   | 10 MB base64-encoded on the Claude API; 5 MB on Amazon Bedrock                                                                        |
| Dimensions                       | 8000x8000 px                                                                                                                          |
| Images per request               | 100 for models with a 200k-token context; 600 for others                                                                              |
| More than 20 images in a request | Stricter per-image dimension limit; staying under 3,000 px per side is safe. Images from earlier turns and inside `tool_result` count |
| Request size                     | 128 MB on the first-party API; other platforms differ                                                                                 |
| Downscaling                      | Above 2,576 px long edge or 4,784 visual tokens on Claude 4.7 and later; above 1,568 px or 1,568 tokens on others                     |

Base64 images are resent in full on every turn [vision].

**Conflict noted:** the changelog for 0.3.229 calls the conversation limit "the API's 32 MB limit", while the current vision docs say 128 MB [changelog] [vision]. Which one Claude Code enforces today is unconfirmed.

**Unconfirmed:** any limit, validation or resizing Claude Code itself applies to images sent through the SDK. No docs or env var cover it. `terminal_reason: 'image_error'` exists [types]. A user-filed issue quotes a 5 MB client-side error ([claude-code #20021](https://github.com/anthropics/claude-code/issues/20021)), which does not match the 10 MB in current docs, and I did not verify it.

**Output side:** Claude cannot generate images [vision]. Images reach a client in user content and inside `tool_result` content; 0.3.243 moved Read's PDF page images into `tool_result` [changelog]. The `Read` tool's structured output has a `type: "image"` variant with `base64`, MIME `type`, `originalSize` and optional original and display dimensions [tools].

## 5. A permission request pending while no client is connected

### `canUseTool`, the baseline

- "The callback can stay pending indefinitely. Execution remains paused until your callback returns." [user-input]
- It receives `signal`, `toolUseID`, `requestId`, `suggestions`, `title`, `displayName`, `description`, `decisionReason` and more [types].
- It may return `null` to suppress the automatic response when a host answers out of band using `requestId` [types] [changelog].
- A `Notification` hook fires with `permission_prompt` after about six seconds of waiting [sdk-hooks].
- _Inference:_ the SDK has no concept of a browser. A closed browser leaves the callback pending in whichever process holds the `Query`, and the prompt lives only as long as that process and its CLI do.
- A protocol-level `control_cancel_request` covers a prompt "another client already answered" [types]. How that surfaces in TS is presumably the `signal`, which is unconfirmed.

### `reinitialize()`

Documented [ts-ref] [types]:

- It re-sends `initialize` to the **running** CLI and returns a fresh response, "so pending permission requests reach your `canUseTool` callback again". Requires Claude Code v2.1.195 or later.
- The response's `pending_permission_requests` lists unresolved `can_use_tool` requests. It is always present from v2.1.268, so absence means an older CLI. Sibling lists cover user dialogs and elicitations; the elicitation list isn't populated in every session.
- A prompt inherited from a previous worker "can remain answerable without appearing here".
- In-flight request IDs are deduped by the SDK, but callbacks "should be idempotent per request_id since a request whose response was lost in the gap will be dispatched again".
- **Side effect:** over stdio the CLI re-registers hooks and resolves hook callbacks it was waiting on: "denying a pending PreToolUse with a retry notice and blocking a pending prompt". "Expect one denied-then-retried tool call or one prompt to re-send."

_Inference on scope:_ the "transport gap" it repairs is between the SDK and the CLI, such as reattaching to a daemon. A browser reconnecting to a process that still holds a live `Query` is not that gap. `reinitialize()` cannot revive a CLI that has exited.

**Unconfirmed:** whether a new OS process can attach to an already running CLI over the default stdio transport. A custom `Transport` interface exists [types], but no document describes reattachment.

### `PreToolUse` `defer`

Documented [hooks] [sdk-hooks]:

- The hook returns `permissionDecision: "defer"`. The tool does not run, the turn ends with a result carrying `stop_reason: "tool_deferred"` and `deferred_tool_use: {id, name, input}`, and "the pending tool call stays in the transcript".
- The process can then exit. Resuming fires `PreToolUse` again for the same call, and the hook returns `allow` (with the answer in `updatedInput`) or `deny`.
- It is "for integrations that run `claude -p`… such as an Agent SDK app".
- It works **only when Claude makes a single tool call in the turn**. With several calls, "`defer` is ignored with a warning and the tool proceeds through the normal permission flow".
- `updatedInput` returned with `defer` is ignored. Multiple hooks resolve `deny` > `defer` > `ask` > `allow`.
- If the answer isn't ready, the hook can defer again. A prompt sent with that resume is answered "without the tool's result" and the call is not run, so "Resume without a prompt".
- On resume with `-p`, Claude Code does not restore any other stored permission mode, so it must be passed again.
- If the tool is gone on resume, the result is `tool_deferred_unavailable`, the prompt doesn't reach Claude, and the run exits with code 1. `CLAUDE_CODE_DROP_UNAVAILABLE_DEFERRED_TOOL=1` drops the call (v2.1.319 or later).

Fit with the permission flow:

- Hooks run first in the evaluation order, before deny, ask and allow rules and the mode [permissions].
- `PreToolUse` input has `permission_mode`, but in the portions of [hooks] I read there is no field saying whether the call would otherwise prompt.
- `PermissionRequest`, which fires only when approval is needed, is documented with `decision.behavior` allow or deny, and `defer` is not mentioned for it [hooks].

_Inference:_ a `defer` hook cannot on its own know that the rules would have allowed a call.

**Unconfirmed:**

- How to resume with no prompt from TS. `query()` requires `prompt: string | AsyncIterable<SDKUserMessage>` [types], and an empty iterable or empty string is not documented.
- Whether `defer` works, and how the call re-fires, inside a long-lived streaming-input session as opposed to a separate resume.

### How long a request can wait

| Mechanism                       | Wait limit                                                                                                                               | Lost when                                      |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| `canUseTool` pending            | "indefinitely"; no timeout documented [user-input]                                                                                       | The holding process or CLI exits (_inference_) |
| Session after `defer`           | "no timeout or retry limit"; on disk until `cleanupPeriodDays`, 30 days by default [hooks]                                               | The retention sweep deletes it                 |
| Hook callback that simply waits | 600 s by default for `PreToolUse`, settable through `timeout`; on timeout Claude Code blocks the call and the turn continues [sdk-hooks] | At the timeout                                 |

**Doc conflict on that last row:** [sdk-hooks] says a `PreToolUse` callback that times out blocks the tool call, while [hooks] says a timed-out `command`, `http` or `mcp_tool` hook "doesn't block the tool call". They name different hook kinds. _Inference:_ the blocking rule is the one that applies to SDK callbacks.

No env var capping a permission wait was found, but [env] was only partly read. Separately, resuming after a long wait hits a cold prompt cache; the effect on cost and context was not researched.

## Still unknown

1. Whether live assistant `uuid`s equal transcript `uuid`s, and whether the transcript is per block. This decides whether history and live frames can be joined by ID. A short spike would settle it.
2. What `getSessionMessages` returns mid-turn in practice, including an in-flight `tool_use` and the lag behind the live stream.
3. What Claude Code itself enforces or resizes for images sent through the SDK, and whether `url` or `file` sources pass through.
4. How to resume a deferred call with no prompt from TS, and whether `defer` works within one long-lived streaming session.
5. What happens to a pending prompt, and to the unfinished turn, if the process holding the `Query` dies without `defer`.

## Method limits

- [ts-ref], [hooks] and [env] are longer than one fetch and were read in parts, so a statement that something is absent means absent from the portions read and from `sdk.d.ts`.
- Docs pages reflect their state on the read date, and the CLI the owner has installed may differ from the 2.1.319 that these types track. Several behaviours above carry minimum versions.
- No fetched page contained instructions aimed at the reader.
