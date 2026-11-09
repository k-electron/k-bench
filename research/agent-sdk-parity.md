# Agent SDK parity with the interactive CLI

Research for [issue 103](https://github.com/k-electron/k-bench/issues/103) on the [Claude Agent map](https://github.com/k-electron/k-bench/issues/102). Checked 2026-11-08 against `@anthropic-ai/claude-agent-sdk` 0.3.319 (its `package.json` declares `claudeCodeVersion` 2.1.319, the same as the installed `claude`), the code.claude.com docs, and the SDK changelog.

**Nothing was executed.** No SDK session ran and no model turn was spent. Every status below comes from published docs, the package's type declarations, or a text search of the package's bundle. Anything that needs a live session to prove is marked `unconfirmed`.

Status words:

- `available`: reachable through the SDK as it is, or by sending the same text as a prompt.
- `different`: reachable, but through another mechanism, usually an option or a `Query` method k-bench has to call.
- `unavailable`: no published method and no documented text form. Sending the command as text might still do something; nothing documents what.
- `unconfirmed`: the sources don't settle it. The note says what is known.

"Published API" means the documented options, `Query` methods and exported functions. `sdk.d.ts` also declares control-request types with no public method to send them, and those are called out where they matter, because the map rules out relying on anything but the published contract.

## The questions the ticket asked

**Fast mode: reachable, but by opt-in.** Pass `fastMode: true` in the `settings` option or through `applyFlagSettings()`, which applies on the next turn. The reason code `sdk_opt_in_required` is documented as "The session hasn't opted in to fast mode". So a `fastMode: true` saved in the owner's user settings apparently does not carry into an SDK session the way it does into the TUI (inferred from that code, not run). `/fast` works without a terminal only in a session launched with fast mode in `--settings`, and the toggle then isn't saved. State comes back as `fast_mode_state` and `fast_mode_disabled_reason` on the init and result messages. The per-model `supportsFastMode` is on `supportedModels()`.

**Advisor: no regression.** The docs name the Agent SDK explicitly: `/advisor <model>`, `/advisor off` and bare `/advisor` (which prints the current advisor) work there from v2.1.260. `advisorModel` is a typed key in `Settings`. Today's Launch option passes `--advisor` for one session, and there are two session-scoped routes to the same thing, neither documented for the SDK specifically: `settings: { advisorModel }` and `extraArgs: { advisor: ... }`. **Trap:** `/advisor <model>` saves to the owner's user settings, except from Remote Control or a remote worker, so using it as a Launch option would change the owner's default for every other session. Advisor Off carries over as `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` in the `env` option. How an advisor call appears in the message stream is not documented.

**`/resume`: different mechanism.** The Remote Control docs name it as terminal-only. The SDK equivalent is `resume`, `continue`, `listSessions()`, `getSessionMessages()` and `getSessionInfo()`. The docs suggest those for building custom session pickers.

**`/rewind`: partly reachable.** Code: `rewindFiles()`, which needs `enableFileCheckpointing` on the session and `extraArgs: { 'replay-user-messages': null }` for user-message UUIDs. Checkpointing is automatic in the TUI and opt-in here, so a session started without it can't be rewound. Conversation: `resumeSessionAt` or `forkSession(id, { upToMessageId })`, both different in kind from the TUI's in-place restore. **Summarize from here and Summarize up to here have no public API.** The changelog mentions a `rewind_conversation` control request, but it appears in neither `sdk.d.ts` nor `Query`.

**`/context`: available twice.** Send `/context` as a prompt (it is in the documented `slash_commands` example, and the reply carries a structured `context_usage` twin), or call `getContextUsage()`, documented as including "the data `/context` shows".

**`/permissions`: viewing is unavailable, changing is a different mechanism.** The dialog has no documented text form. `list_permission_rules` is declared in `sdk.d.ts` as "the same data /permissions lists in the terminal", but `Query` has no method for it. Changing rules goes through `canUseTool` suggestions returned as `updatedPermissions`, `applyFlagSettings({ permissions })`, `allowedTools` / `disallowedTools`, or the documented settings files. Recent denials arrive as `permission_denied` messages. `resolveSettings()` reads the raw settings cascade but is marked `@alpha` and is not the session's live rule state.

**User-installed plugins: expected to load by default, not proven.** The SDK plugins page reads the other way: it describes only the `plugins` option and says a CLI-installed plugin can be used "by providing its installation path". Against that:

- The headless docs say that without `--bare`, `claude -p` "discovers and loads" installed plugins "as an interactive session would".
- The SDK adds `--setting-sources` only when `settingSources` is set, so the default launch matches `claude -p`. A text search of the bundle found no `"--bare"`.
- `enabledPlugins` is a settings key resolved from user, project and local sources, and the SDK's own `ClaimOptions` comment says `enabledPlugins` decides "which of the folder's ... plugins the claim starts".
- The init message reports `plugins` and `plugin_errors`.

One check settles it: read `plugins` from the first init message in a real session. Two caveats either way. Plugins synced from claude.ai depend on a claude.ai sign-in, and a repository's project-scope plugins need workspace trust, which the SDK never prompts for (see the workspace trust row).

**Skills autocomplete: `supportedCommands()` carries it, the init message does not.**

| Source                            | Shape                              | Skills included          | Description and argument hint |
| :-------------------------------- | :--------------------------------- | :----------------------- | :---------------------------- |
| init `slash_commands`             | `string[]`                         | yes                      | **no, names only**            |
| init `skills`                     | `string[]`                         | yes, user-invocable only | no                            |
| `supportedCommands()`             | `SlashCommand[]`                   | yes                      | **yes**                       |
| `initializationResult().commands` | `SlashCommand[]`                   | yes                      | yes                           |
| `commands_changed` message        | `SlashCommand[]`, full replacement | yes                      | yes                           |
| `reloadSkills()`                  | `SlashCommand`-shaped              | skills only              | yes                           |

`SlashCommand` is `{ name, description, argumentHint, aliases?, builtin? }`. `builtin` needs SDK 0.3.277 and the live mid-session list needs 0.3.216. The init field `terminal_slash_commands` names the entries a remote UI should hide, such as `exit`. Skills are confirmed in `supportedCommands()` by a changelog fix that removed `user-invocable: false` skills from it, and the type comment itself calls it the list of "available skills". Sources: [types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts), [reference](https://code.claude.com/docs/en/agent-sdk/typescript), [changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md).

Limits for autocomplete: `argumentHint` is one flat string, so there is no completion of argument values (the TUI's `/add-dir` paths or `/mcp reconnect` servers). There is no source field beyond `builtin`, so plugin and user commands can only be told apart by a `plugin:` prefix. Whether `supportedCommands()` omits terminal-only commands the way init does is not stated.

## Gaps worth flagging

1. Rewind's Summarize from here and Summarize up to here have no public API. Code rewind only works in sessions started with checkpointing on.
2. Viewing live permission rules by scope has no public API.
3. `@` file completion has no public API. `file_suggestions` is declared ("the same fuzzy-matched results the TUI shows") with no `Query` method.
4. `!` shell mode, `/btw`, `/hooks`, `/export`, `/copy`, `/diff`, `/add-dir` and `/cd` have no public API or documented text form.
5. Focus view is a Launch option today and is not on the map's cosmetics list. `view_mode` is reported on SDK init and is more than visual ("the model is told the user sees only its final message per turn"), but whether `settings: { viewMode }` sets it in an SDK session is unconfirmed.
6. Project `permissions.allow` rules are not used in a folder never trusted, and the SDK never shows the trust dialog. A folder the owner has only ever opened through Claude Agent would run without those rules, with only a stderr warning.
7. Fast mode: a saved preference apparently doesn't carry over, so the owner's TUI default and Claude Agent would disagree.
8. `--bare` is documented as "the recommended mode for scripted and SDK calls" that "will become the default for `-p` in a future release". If it reached SDK launches it would drop CLAUDE.md, skills, plugins, hooks and memory, the whole harness tier. The SDK doesn't pass it today.
9. The SDK overview says that unless previously approved, third-party developers may not "offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK". k-bench is a published package and the map has it use the owner's existing `claude` auth. Whether a self-hosted, single-owner tool falls under this is a question for the owner, not one the docs answer. The same page permits the name "Claude Agent" and forbids "Claude Code" branding on such products.

## First-pass claims, checked

| Claim                                                                        | Result                                                                                                                         | Source                                                             |
| :--------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| `settingSources` defaults to user, project, local                            | Confirmed. The skills page says "user and project", which disagrees with the features page, the reference and the type comment | https://code.claude.com/docs/en/agent-sdk/claude-code-features     |
| `claude_code` preset exists                                                  | Confirmed. Without it the default is a minimal prompt, so it has to be set                                                     | https://code.claude.com/docs/en/agent-sdk/typescript               |
| Streaming input enables interrupt, setModel, setPermissionMode, image blocks | Confirmed                                                                                                                      | https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| `/theme`, `/terminal-setup`, `/login` TUI-only                               | Confirmed, each named                                                                                                          | https://code.claude.com/docs/en/headless                           |
| `/tui`, `/scroll-speed` TUI-only                                             | Inferred only: terminal renderer settings, not named as excluded                                                               | https://code.claude.com/docs/en/commands                           |
| `/focus` TUI-only                                                            | **Partly wrong.** Fullscreen-only in the TUI, but it has a Remote Control form, and `view_mode` is reported to SDK hosts       | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts  |
| Bare `/model` picker TUI-only                                                | Confirmed: "With `-p`, pass a model argument"                                                                                  | https://code.claude.com/docs/en/commands                           |
| `rewindFiles()` and `getContextUsage()` exist                                | Confirmed, with the prerequisites above                                                                                        | https://code.claude.com/docs/en/agent-sdk/typescript               |

## Parity checklist

### Tier 1: harness behaviour (must be identical, never reimplemented)

| Capability                            | Through the SDK                                                                                                                                                       | Status      | Source                                                            |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------- | :---------------------------------------------------------------- |
| CLAUDE.md and rules                   | Loaded with default sources                                                                                                                                           | available   | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| User, project, local settings         | Loaded when `settingSources` is omitted                                                                                                                               | available   | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| Claude Code system prompt             | `systemPrompt: { type: 'preset', preset: 'claude_code' }`                                                                                                             | different   | https://code.claude.com/docs/en/agent-sdk/typescript              |
| Skills, discovery and invocation      | Default, matching the CLI                                                                                                                                             | available   | https://code.claude.com/docs/en/agent-sdk/skills                  |
| `.claude/commands` files              | Same scopes as skills                                                                                                                                                 | available   | https://code.claude.com/docs/en/agent-sdk/skills                  |
| User-installed plugins                | Expected to load; see above                                                                                                                                           | unconfirmed | https://code.claude.com/docs/en/headless                          |
| Filesystem hooks                      | Loaded through setting sources                                                                                                                                        | available   | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| MCP servers                           | Settings and `.mcp.json`. Unlike the TUI, project servers connect without the approval prompt                                                                         | available   | https://code.claude.com/docs/en/permissions                       |
| claude.ai connectors                  | Loaded with a claude.ai login                                                                                                                                         | available   | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| Subagents                             | `.claude/agents` through setting sources, plus the `agents` option                                                                                                    | available   | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| Agent teams                           | "Not directly configured via SDK options"                                                                                                                             | unconfirmed | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| Permission rules and evaluation order | Same flow, ending in `canUseTool`; no callback means deny                                                                                                             | available   | https://code.claude.com/docs/en/agent-sdk/permissions             |
| Permission modes                      | `default`, `acceptEdits`, `plan`, `dontAsk`, `auto`, `bypassPermissions`; `permissions.defaultMode` honoured                                                          | available   | https://code.claude.com/docs/en/agent-sdk/permissions             |
| Workspace trust                       | Never prompted. Hooks run; project `permissions.allow` is not used in a never-trusted folder. Whether trust accepted earlier in the TUI counts is implied, not stated | different   | https://code.claude.com/docs/en/permissions                       |
| Auto mode                             | `permissionMode: 'auto'`; `supportsAutoMode` per model                                                                                                                | available   | https://code.claude.com/docs/en/agent-sdk/permissions             |
| Plan mode enforcement                 | `permissionMode: 'plan'`; keeps its blocks without a terminal                                                                                                         | available   | https://code.claude.com/docs/en/permission-modes                  |
| Automatic compaction                  | Same, with a `compact_boundary` message and `PreCompact` hook                                                                                                         | available   | https://code.claude.com/docs/en/agent-sdk/agent-loop              |
| Auto memory                           | Read regardless of `settingSources`; needs Write and Edit to save                                                                                                     | available   | https://code.claude.com/docs/en/agent-sdk/claude-code-features    |
| Sandbox                               | `sandbox` option and settings                                                                                                                                         | available   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| Output styles                         | Settings; `/output-style` from v2.1.269                                                                                                                               | available   | https://code.claude.com/docs/en/headless                          |
| Model and effort defaults             | Resolved from settings when options are omitted                                                                                                                       | available   | https://code.claude.com/docs/en/agent-sdk/agent-loop              |
| Advisor                               | `/advisor`, `advisorModel`; `env` for off. See above                                                                                                                  | different   | https://code.claude.com/docs/en/advisor                           |
| Fast mode                             | Per-session opt-in. See above                                                                                                                                         | different   | https://code.claude.com/docs/en/agent-sdk/typescript              |
| Using the installed `claude`          | `pathToClaudeCodeExecutable`; the default is the bundled binary. Supported version skew is not documented; init reports `claude_code_version` and `capabilities`      | unconfirmed | https://code.claude.com/docs/en/agent-sdk/typescript              |

### Tier 2: interactive capabilities (must eventually be reachable from the web)

The conversation:

| Capability                               | Through the SDK                                                         | Status      | Source                                                             |
| :--------------------------------------- | :---------------------------------------------------------------------- | :---------- | :----------------------------------------------------------------- |
| Streaming output                         | `includePartialMessages`                                                | available   | https://code.claude.com/docs/en/agent-sdk/agent-loop               |
| Multi-turn conversation                  | Streaming input                                                         | available   | https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| Interrupt (Esc, Ctrl+C)                  | `interrupt()`                                                           | different   | https://code.claude.com/docs/en/agent-sdk/typescript               |
| Queue messages while working             | Streaming input; an interrupt reports `still_queued`                    | different   | https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| Take back a queued message               | `cancel_async_message` is declared with no `Query` method               | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts  |
| Paste or drag images                     | Base64 image blocks in a user message                                   | different   | https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| `@` file mentions and completion         | `file_suggestions` declared with no `Query` method                      | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts  |
| `!` shell mode                           | No published API; the types mention only an internal "bash mode" append | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts  |
| Skills and command menu                  | `supportedCommands()` and `commands_changed`                            | different   | https://code.claude.com/docs/en/agent-sdk/typescript               |
| Running a skill or command by name       | Send `/<name>` as the prompt                                            | available   | https://code.claude.com/docs/en/agent-sdk/skills                   |
| Chaining up to six skills in one message | Documented "at the terminal prompt" only                                | unconfirmed | https://code.claude.com/docs/en/commands                           |
| Prompt suggestions                       | `promptSuggestions` option                                              | available   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts  |
| Thinking display                         | `thinking` option; `display`                                            | different   | https://code.claude.com/docs/en/agent-sdk/agent-loop               |
| Advisor consultation display             | Message shape not documented                                            | unconfirmed | https://code.claude.com/docs/en/advisor                            |
| Unknown or new message types             | Open union; `capabilities` for feature detection                        | available   | https://code.claude.com/docs/en/headless                           |

Prompts that need an answer:

| Capability                        | Through the SDK                                                                | Status      | Source                                                                  |
| :-------------------------------- | :----------------------------------------------------------------------------- | :---------- | :---------------------------------------------------------------------- |
| Allow or Deny prompt              | `canUseTool`; the callback can stay pending indefinitely                       | different   | https://code.claude.com/docs/en/agent-sdk/user-input                    |
| "Yes, don't ask again"            | `suggestions` echoed as `updatedPermissions`; honour `suppressAlwaysAllowRule` | different   | https://code.claude.com/docs/en/agent-sdk/user-input                    |
| AskUserQuestion                   | `canUseTool`; not in subagents                                                 | different   | https://code.claude.com/docs/en/agent-sdk/user-input                    |
| Plan approval                     | `ExitPlanMode` is a typed tool; approval through `canUseTool` isn't documented | unconfirmed | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk-tools.d.ts |
| MCP elicitation                   | `onElicitation` option                                                         | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts       |
| Other dialogs                     | `onUserDialog` plus declared `supportedDialogKinds`; undeclared kinds degrade  | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts       |
| Re-attach and see pending prompts | `reinitialize()` redelivers pending requests                                   | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts       |

Session commands:

| Capability                             | Through the SDK                                                                                                            | Status      | Source                                                            |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :---------- | :---------------------------------------------------------------- |
| `/resume`, `/continue`                 | `resume`, `continue`, session listing functions                                                                            | different   | https://code.claude.com/docs/en/agent-sdk/sessions                |
| Open in terminal                       | Sessions share the on-disk store with the CLI; `--resume` finds them by ID. Taking turns between the two is not documented | unconfirmed | https://code.claude.com/docs/en/agent-sdk/sessions                |
| `/rewind` restore code                 | `rewindFiles()` with checkpointing on. Bash and subagent edits aren't tracked, as in the TUI                               | different   | https://code.claude.com/docs/en/agent-sdk/file-checkpointing      |
| `/rewind` restore conversation         | `resumeSessionAt`, `forkSession(id, { upToMessageId })`                                                                    | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/rewind` summarize from or up to here | No public API                                                                                                              | unavailable | https://code.claude.com/docs/en/checkpointing                     |
| `/branch`                              | `forkSession()`, or `resume` with `forkSession: true`                                                                      | different   | https://code.claude.com/docs/en/agent-sdk/sessions                |
| `/fork`, `/background`                 | Bound to agent view; not documented for the SDK                                                                            | unconfirmed | https://code.claude.com/docs/en/commands                          |
| `/rename`                              | `renameSession()`; the command works in `-p`                                                                               | available   | https://code.claude.com/docs/en/headless                          |
| `/clear`                               | Send as a prompt in streaming input                                                                                        | available   | https://code.claude.com/docs/en/agent-sdk/skills                  |
| `/compact`                             | Send as a prompt                                                                                                           | available   | https://code.claude.com/docs/en/agent-sdk/skills                  |
| `/context`                             | Send as a prompt, or `getContextUsage()`                                                                                   | available   | https://code.claude.com/docs/en/agent-sdk/typescript              |
| `/usage`, `/cost`                      | Prompt with `usage_report` twin. The direct method is named `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`    | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/export`, `/copy`                     | No command form documented; `getSessionMessages()` gives the transcript                                                    | different   | https://code.claude.com/docs/en/agent-sdk/sessions                |
| `/diff`                                | Dialog only; tool inputs carry edits                                                                                       | unavailable | https://code.claude.com/docs/en/interactive-mode                  |
| `/btw`                                 | Mentioned only as an internal control; no public method                                                                    | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/recap`                               | Works over Remote Control as text; the automatic recap never appears without a terminal                                    | unconfirmed | https://code.claude.com/docs/en/remote-control                    |
| `/goal`, `/loop`                       | Not documented for the SDK. A self-paced `/loop` wakeup is described only for prompts passed as text, not streaming input  | unconfirmed | https://code.claude.com/docs/en/headless                          |
| Background tasks, `/tasks`             | `backgroundTasks()`, `stopTask()`, `task_*` messages                                                                       | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| Usage-limit wait and continue          | Menu row isn't available in `-p`; `SDKRateLimitEvent` reports limits                                                       | unavailable | https://code.claude.com/docs/en/interactive-mode                  |

Configuration commands:

| Capability                                                        | Through the SDK                                                                                                                | Status      | Source                                                            |
| :---------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :---------- | :---------------------------------------------------------------- |
| `/model`                                                          | `setModel()`, `supportedModels()`, or `/model <name>`, which isn't saved as the default in `-p`                                | different   | https://code.claude.com/docs/en/commands                          |
| `/effort`                                                         | `effort` option, `applyFlagSettings`, or `/effort <level>`                                                                     | different   | https://code.claude.com/docs/en/commands                          |
| `/fast`                                                           | See above                                                                                                                      | different   | https://code.claude.com/docs/en/fast-mode                         |
| `/advisor`                                                        | See above                                                                                                                      | available   | https://code.claude.com/docs/en/advisor                           |
| `/permissions` view                                               | No public API                                                                                                                  | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/permissions` change                                             | `updatedPermissions`, `applyFlagSettings`, settings files                                                                      | different   | https://code.claude.com/docs/en/agent-sdk/user-input              |
| Switching permission mode (Shift+Tab)                             | `setPermissionMode()`                                                                                                          | different   | https://code.claude.com/docs/en/agent-sdk/permissions             |
| `/plan`                                                           | `setPermissionMode('plan')`; the command form isn't documented for the SDK                                                     | different   | https://code.claude.com/docs/en/agent-sdk/permissions             |
| `/config key=value`                                               | Works in `-p`; `applyFlagSettings`; `updateSettings` has a small allowlist                                                     | different   | https://code.claude.com/docs/en/commands                          |
| `/config` panel, `/status`                                        | Panels only; `initializationResult()` and `accountInfo()` give parts                                                           | unconfirmed | https://code.claude.com/docs/en/commands                          |
| `/mcp`                                                            | Text summary in `-p`; `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()`. MCP OAuth from a host isn't documented | different   | https://code.claude.com/docs/en/commands                          |
| `/plugin`                                                         | "Isn't available in this environment" without a terminal; `claude plugin` works from a shell                                   | unavailable | https://code.claude.com/docs/en/plugins/cli-reference             |
| `/reload-plugins`                                                 | `reloadPlugins()`, or as a prompt from v2.1.260                                                                                | available   | https://code.claude.com/docs/en/plugins/cli-reference             |
| `/reload-skills`                                                  | `reloadSkills()`                                                                                                               | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/skills` panel                                                   | List from `supportedCommands()`; visibility through the `skillOverrides` setting                                               | different   | https://code.claude.com/docs/en/commands                          |
| `/hooks`                                                          | `get_hooks_listing` declared with no `Query` method                                                                            | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/memory`                                                         | No API; auto memory files and CLAUDE.md are ordinary files                                                                     | unavailable | https://code.claude.com/docs/en/commands                          |
| `/agents`                                                         | `supportedAgents()`                                                                                                            | different   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/add-dir`, `/cd`                                                 | `additionalDirectories` at launch only; no public mid-session method                                                           | unavailable | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/init`, `/code-review`, `/security-review`, other bundled skills | Prompts handed to Claude; `/code-review` and `/verify` named for the SDK                                                       | available   | https://code.claude.com/docs/en/agent-sdk/skills                  |
| `/login`, `/logout`                                               | Terminal only. The map keeps credentials outside k-bench                                                                       | unavailable | https://code.claude.com/docs/en/headless                          |
| Focus view (a Launch option today)                                | `view_mode` is reported; setting it through `settings` isn't documented                                                        | unconfirmed | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |

### Tier 3: terminal-only cosmetics (dropped)

| Capability              | Through the SDK                                       | Status      | Source                                                            |
| :---------------------- | :---------------------------------------------------- | :---------- | :---------------------------------------------------------------- |
| `/theme`, custom themes | "Isn't available in this environment"                 | unavailable | https://code.claude.com/docs/en/agent-sdk/skills                  |
| `/terminal-setup`       | Named as needing a terminal                           | unavailable | https://code.claude.com/docs/en/agent-sdk/skills                  |
| `/tui`, `/scroll-speed` | Not named; fullscreen renderer settings               | unconfirmed | https://code.claude.com/docs/en/commands                          |
| Vim mode                | Removed as a command; an editor mode in `/config`     | unavailable | https://code.claude.com/docs/en/commands                          |
| `/keybindings`          | Terminal input only                                   | unconfirmed | https://code.claude.com/docs/en/commands                          |
| `/statusline`           | The init comment gives it as a terminal-bound command | available   | https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.319/sdk.d.ts |
| `/color`                | Works in `-p`; has no meaning without the prompt bar  | available   | https://code.claude.com/docs/en/commands                          |

## Could not be confirmed

All of these need a live session, which this research did not run:

- Whether user-installed plugins appear in `plugins` on init.
- Whether a saved `fastMode: true` is ignored in an SDK session, and whether `settings: { advisorModel }` and `extraArgs: { advisor }` behave as `--advisor` does.
- Whether `settings: { viewMode: 'focus' }` takes effect.
- What an advisor consultation looks like in the message stream.
- Whether plan approval reaches `canUseTool`.
- Which built-ins actually appear in `slash_commands` and `supportedCommands()` for this version, and whether `/resume` or `/permissions` returns "isn't available in this environment".
- Whether the same conversation can move between an SDK session and `claude --resume` cleanly, and whether checkpoints survive that move.

The SDK's types and docs change between releases. These results hold for 0.3.319 and CLI 2.1.319.
