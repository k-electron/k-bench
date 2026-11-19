# Claude Agent parity checklist

Every interactive capability of Claude TUI, and for each one whether a [Claude Agent](../GLOSSARY.md) does it, it goes through Open in terminal, or it is out of scope. This is the map's drift guard: when Claude Code grows a capability, it gets a row here, so nothing is quietly missing from the Claude Agent.

The decisions come from [the spec](https://github.com/k-electron/k-bench/issues/128), from [What is the line for a usable Claude Agent?](https://github.com/k-electron/k-bench/issues/108) (a normal working day on phone or desktop, with Claude TUI only for occasional chores), and from the research on the `research/agent-sdk-parity` branch. Rows that research left `unconfirmed` were settled by [the live check](https://github.com/k-electron/k-bench/issues/121), run against a real `claude`; they say so. The user-facing side of this is [the Claude Agent guide](guide/claude-agent.md).

## How to read it

The three tiers, from the map:

1. **Harness behaviour** is identical in a Claude Agent and never reimplemented in k-bench. It comes from running the owner's own `claude`.
2. **Interactive capabilities** must eventually be reachable from the web. This is where the work is.
3. **Terminal-only cosmetics** are dropped.

The **Where** column says one of three things:

- **Claude Agent**: the Claude Agent does it, in the web interface.
- **Open in terminal**: the Claude Agent doesn't, and the owner switches the Session to a Claude TUI to do it. Anything the web interface meets and can't show or answer becomes an Unsupported row that offers the switch.
- **Out of scope**: nobody does it for now. The **Notes** column gives the route where there is one.

The **Ticket** column is the issue under the spec that delivers the row, as `#n`. A dash means no ticket.

**Ticking rows.** Each row has a **Done** box: `[ ]` or `[x]` (`n/a` for rows that are never built). A ticket that delivers a row changes its `[ ]` to `[x]` in the same pull request. Keep the row format as it is, so each tick is a one-line edit. A new capability gets a new row in the right tier, with its tier decided here first.

## Tier 1: harness behaviour

Identical to the terminal, never reimplemented. The Claude Agent only has to launch `claude` the way the terminal does and not get in the way. The runtime that does it is described in [Claude Agent internals](internals/agent.md).

| Done  | Capability                                        | Where            | Ticket | Notes                                                                                                                                                                                                                              |
| :---- | :------------------------------------------------ | :--------------- | :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[x]` | CLAUDE.md and rules                               | Claude Agent     | #133   | Loaded through the default setting sources.                                                                                                                                                                                        |
| `[x]` | User, project and local settings                  | Claude Agent     | #133   | Same sources as the terminal.                                                                                                                                                                                                      |
| `[x]` | The Claude Code system prompt                     | Claude Agent     | #133   | The `claude_code` preset, which the SDK does not use unless asked.                                                                                                                                                                 |
| `[x]` | Skills and `.claude/commands` files               | Claude Agent     | #133   | Discovery and invocation are the harness's.                                                                                                                                                                                        |
| `[x]` | User-installed plugins                            | Claude Agent     | #133   | Confirmed by the live check: they appear in the first start-up message, with no plugin errors.                                                                                                                                     |
| `[x]` | Hooks from settings                               | Claude Agent     | #133   | They run, including in a folder never trusted (see Workspace trust).                                                                                                                                                               |
| `[x]` | MCP servers                                       | Claude Agent     | #133   | From settings and `.mcp.json`. Unlike the terminal, project servers connect without the approval prompt (see Workspace trust).                                                                                                     |
| `[x]` | claude.ai connectors                              | Claude Agent     | #133   | Loaded with a claude.ai login.                                                                                                                                                                                                     |
| `[x]` | Subagents defined in `.claude/agents`             | Claude Agent     | #133   | Shown and stoppable in the Transcript by #149.                                                                                                                                                                                     |
| `[ ]` | Agent teams                                       | Open in terminal | -      | The SDK documents no way to configure them. Not confirmed either way.                                                                                                                                                              |
| `[x]` | Permission rules and their evaluation order       | Claude Agent     | #135   | The same flow, ending in the permission callback, so the Agent asks exactly when the terminal would: k-bench sets no allowed tools and no mode.                                                                                    |
| `[x]` | Permission modes, auto mode and plan mode         | Claude Agent     | #139   | The harness enforces them. #139 shows and switches the mode. Plan approval is #147.                                                                                                                                                |
| `[ ]` | Workspace trust                                   | Open in terminal | -      | The SDK never shows Claude Code's trust dialog. See [Folder trust](#folder-trust) below.                                                                                                                                           |
| `[x]` | Automatic compaction                              | Claude Agent     | #133   | The harness compacts. #148 shows the compaction line.                                                                                                                                                                              |
| `[x]` | Auto memory                                       | Claude Agent     | #133   | Read and written as in the terminal.                                                                                                                                                                                               |
| `[x]` | Sandbox                                           | Claude Agent     | #133   | From settings.                                                                                                                                                                                                                     |
| `[x]` | Output styles                                     | Claude Agent     | #133   | From settings.                                                                                                                                                                                                                     |
| `[ ]` | Model and effort defaults                         | Claude Agent     | #143   | Resolved from the owner's settings when a Launch option is Default.                                                                                                                                                                |
| `[ ]` | The advisor                                       | Claude Agent     | #143   | A session-scoped route, confirmed by the live check: `advisorModel` in the SDK's `settings` option, or the `advisor` flag. Never `/advisor <model>`, which saves the owner's default. Off is `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`. |
| `[x]` | Running the installed `claude`, not a bundled one | Claude Agent     | #133   | k-bench's package ships no copy of Claude Code. #157 shows the version and warns when it is older than the SDK expects.                                                                                                            |
| `[x]` | File checkpointing                                | Claude Agent     | #133   | On from the first launch, because it can't be added to a running Session and the terminal's `/rewind` depends on it.                                                                                                               |
| `[ ]` | Subscription login only                           | Claude Agent     | #157   | If `claude` would bill an API key, another provider or no subscription, the Agent ends with the reason and the Session is Stopped. k-bench reads no credentials.                                                                   |
| `n/a` | Fast mode                                         | Out of scope     | -      | It bills only to usage credits and isn't wanted for now. Route: none.                                                                                                                                                              |

## Tier 2: interactive capabilities

Reachable from the web, now or eventually. Grouped as Claude Code's own interface groups them.

### Starting one

| Done  | Capability                                                    | Where        | Ticket     | Notes                                                                                                                      |
| :---- | :------------------------------------------------------------ | :----------- | :--------- | :------------------------------------------------------------------------------------------------------------------------- |
| `[x]` | One New Session dialog: Shell, Claude TUI, Claude Agent (WIP) | Claude Agent | #130, #133 | Remembers the last kind and Launch options, and Enter launches. Claude Agent is never the first-time default.              |
| `[ ]` | Launch options: model, effort, advisor, Focus view            | Claude Agent | #143       | The same meaning as for a Claude TUI. Focus view is confirmed settable: the SDK reports `view_mode` `focus` on start-up.   |
| `n/a` | Changing Launch options during the Session's life             | Out of scope | -          | Route: type `/model <name>` or `/effort <level>` (#150), or Open in terminal. A Restart passes the original options again. |

### The conversation

| Done  | Capability                                        | Where            | Ticket     | Notes                                                                                                                               |
| :---- | :------------------------------------------------ | :--------------- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `[x]` | Send a prompt, watch the reply stream             | Claude Agent     | #133       | Partial messages on.                                                                                                                |
| `[x]` | Close the browser and carry on, mid-turn included | Claude Agent     | #134       | Replay by sequence number, no gaps or duplicates. Closing a tab, a device sleeping or k-bench restarting never stops an Agent.      |
| `[x]` | Every device sends, interrupts and answers        | Claude Agent     | #134, #135 | Devices are equal views of the same Agent. The first answer to an Allow/Deny wins, and any device can interrupt (#138).             |
| `[x]` | Interrupt (Esc, Ctrl+C)                           | Claude Agent     | #138       | A button by the input, and Esc on desktop. Messages already sent and waiting are not taken back: they run next.                     |
| `[x]` | Send messages while Claude is working             | Claude Agent     | #138       | Each shows "(queued)" until Claude picks it up.                                                                                     |
| `n/a` | Take back a queued message                        | Out of scope     | -          | The SDK has no public method for it.                                                                                                |
| `[x]` | Prompt history (Up and Down in an empty input)    | Claude Agent     | #138       | From the conversation, so every device has the same history.                                                                        |
| `[x]` | Unsent drafts                                     | Claude Agent     | #140       | Kept on the device you typed on, per Agent. Never synced.                                                                           |
| `[x]` | Paste or drag-drop images, and the photo library  | Claude Agent     | #159       | Thumbnails first, and a message when an image is over Claude's limits. Follows a default not yet confirmed with the owner.          |
| `[x]` | `@path` mentions typed in a prompt                | Claude Agent     | #133       | Passed through as typed, never marked client-composed. Confirmed by the live check: the file is expanded as in the terminal.        |
| `[ ]` | `@` file picker                                   | Claude Agent     | #160       | k-bench's own picker over the Workspace folder, because the SDK exposes none. Follows a default not yet confirmed with the owner.   |
| `n/a` | `!` shell mode                                    | Out of scope     | -          | The SDK has no public API for it. Route: a shell Session in the same Workspace is one tap away.                                     |
| `[ ]` | The `/` menu: commands and skills                 | Claude Agent     | #150       | Live from the SDK's command list, with descriptions and argument hints, hiding terminal-only entries. Completion stops at the name. |
| `n/a` | Completing a command's argument values            | Out of scope     | -          | The SDK's argument hint is one flat string, so there is nothing to complete from.                                                   |
| `[ ]` | Running a skill or command by name                | Claude Agent     | #150       | Typed `/<name>` is sent as the prompt.                                                                                              |
| `[ ]` | Chaining several skills in one message            | Open in terminal | -          | Documented only for the terminal prompt. Not confirmed for the SDK.                                                                 |
| `n/a` | Prompt suggestions                                | Out of scope     | -          | Route: none.                                                                                                                        |

### Reading the Transcript

| Done  | Capability                                                                                                                         | Where            | Ticket     | Notes                                                                                                                                                     |
| :---- | :--------------------------------------------------------------------------------------------------------------------------------- | :--------------- | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[x]` | Transcript in Claude TUI's shape, with markdown, collapsed tool output, coloured diffs, thinking line, header line and status line | Claude Agent     | #136       | The browser renders from the raw SDK messages. The status line also shows context left until auto-compact, polled from the SDK, because it is not pushed. |
| `[ ]` | Focus view's condensed Transcript                                                                                                  | Claude Agent     | #143       | Tool calls as single collapsed lines.                                                                                                                     |
| `[x]` | Raw JSON of one message, and of the whole Transcript                                                                               | Claude Agent     | #137       | Long-press on a phone, `</>` on desktop, and a raw switch in the header.                                                                                  |
| `[x]` | Scroll back through older turns                                                                                                    | Claude Agent     | #141       | Loaded by sequence number as you scroll.                                                                                                                  |
| `[ ]` | Compaction, hook output, MCP activity, errors, usage-limit messages                                                                | Claude Agent     | #148       | Each a Transcript line, shown plainly.                                                                                                                    |
| `[ ]` | The advisor's consultation                                                                                                         | Claude Agent     | #148       | A line even when the advice is encrypted. Confirmed by the live check: a `server_tool_use` named `advisor`, then an `advisor_tool_result`.                |
| `[ ]` | The task list (TodoWrite) as a checklist                                                                                           | Claude Agent     | #148       | Updates in place, as the terminal shows it.                                                                                                               |
| `[ ]` | Claude Code's folder trust warning                                                                                                 | Claude Agent     | #148       | Shown in the conversation when one appears. k-bench does not detect trust itself.                                                                         |
| `[ ]` | Subagents and background tasks, with their own Stop                                                                                | Claude Agent     | #149       | A live spinner and progress. Also what Open in terminal lists as "would stop". The terminal's `/tasks` panel is not reproduced.                           |
| `[ ]` | A message type k-bench doesn't recognise                                                                                           | Open in terminal | #153, #154 | An Unsupported row, and an entry in the running list.                                                                                                     |
| `n/a` | The usage-limit "wait and continue" row                                                                                            | Out of scope     | -          | Limit messages are still shown plainly (#148).                                                                                                            |

### Answering Claude

| Done  | Capability                                    | Where            | Ticket     | Notes                                                                                                                                                           |
| :---- | :-------------------------------------------- | :--------------- | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[ ]` | Allow or Deny                                 | Claude Agent     | #135, #146 | A bare card first (#135), then the docked panel with tool, target, diff and numbered choices (#146). The Agent waits as long as it lives, whoever is connected. |
| `[ ]` | "Yes, don't ask again"                        | Claude Agent     | #146       | Offered where Claude Code offers it.                                                                                                                            |
| `[ ]` | "No, and tell Claude what to do differently"  | Claude Agent     | #146       | Opens the input for a reply.                                                                                                                                    |
| `[ ]` | An answered prompt leaves a line              | Claude Agent     | #146       | `⎿ permission: ...` in the Transcript.                                                                                                                          |
| `[ ]` | A prompt that was open when the Agent stopped | Claude Agent     | #144       | Shown as "not answered, the Agent stopped", so it never looks approved.                                                                                         |
| `[ ]` | AskUserQuestion                               | Claude Agent     | #147       | In the same docked panel.                                                                                                                                       |
| `[ ]` | Plan approval                                 | Claude Agent     | #147       | Confirmed by the live check: `ExitPlanMode` reaches the permission callback with the plan, and Claude Code writes the plan into its plans folder.               |
| `[ ]` | MCP elicitation and other rarer dialogs       | Open in terminal | #153       | Declined and shown as an Unsupported row with the switch.                                                                                                       |

### Session commands

| Done  | Capability                                                              | Where            | Ticket | Notes                                                                                                                                                                 |
| :---- | :---------------------------------------------------------------------- | :--------------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `n/a` | `/resume`, `/continue`                                                  | Out of scope     | -      | A different conversation is a new Claude Session. There is no picker.                                                                                                 |
| `[ ]` | Open in terminal                                                        | Claude Agent     | #155   | Switches the Session to a Claude TUI on the same conversation. Confirmed by the live check: `claude --resume` shows the web turns.                                    |
| `[ ]` | Open in web, with the terminal's turns imported                         | Claude Agent     | #156   | Confirmed by the live check. If the terminal compacted, the import starts from the summary and the divider says so.                                                   |
| `n/a` | Following a terminal `/clear` back to the web                           | Out of scope     | -      | Route: none. The Claude Agent keeps the conversation it had before.                                                                                                   |
| `[ ]` | `/rewind`: restore code                                                 | Open in terminal | #155   | Confirmed by the live check: the terminal's "Restore code" removes a file the Agent created, because checkpointing is on.                                             |
| `n/a` | A rewind or branch UI: restore or summarize the conversation, `/branch` | Out of scope     | -      | Route: the terminal's `/rewind`, through Open in terminal. Summarize from here and up to here have no public SDK API.                                                 |
| `[ ]` | `/rename`                                                               | Claude Agent     | #150   | A typed command, with the reply in the conversation.                                                                                                                  |
| `[ ]` | `/clear`                                                                | Claude Agent     | #151   | The Agent moves to the new conversation, so a Restart resumes it. The new ID comes from the next start-up message, not from `conversation_reset`. Shown as a divider. |
| `[ ]` | `/compact`, `/context`, `/usage`, `/cost`                               | Claude Agent     | #150   | Typed, with the reply in the conversation and no panel.                                                                                                               |
| `[ ]` | `/goal`                                                                 | Claude Agent     | #152   | Works when typed. Its "Stop hook feedback" re-prompts show as goal check-ins. Confirmed by the live check.                                                            |
| `[ ]` | `/loop`                                                                 | Claude Agent     | #152   | Works when typed. Turns it starts by itself show, count as Working and raise the Bell (#142, #145). The loop dies with the runtime. Confirmed by the live check.      |
| `n/a` | `/btw`                                                                  | Out of scope     | -      | No public SDK API. Route: Open in terminal.                                                                                                                           |
| `n/a` | `/diff`                                                                 | Out of scope     | -      | A dialog only. Route: Open in terminal. Edits already show as diffs in the Transcript (#136).                                                                         |
| `[ ]` | `/export`, `/copy`                                                      | Open in terminal | -      | No command form is documented for the SDK.                                                                                                                            |
| `[ ]` | `/recap`                                                                | Open in terminal | -      | Not confirmed for the SDK.                                                                                                                                            |

### Configuration commands

| Done  | Capability                                                           | Where            | Ticket | Notes                                                                                                                            |
| :---- | :------------------------------------------------------------------- | :--------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------- |
| `[x]` | Switching permission mode (Shift+Tab, `/plan`)                       | Claude Agent     | #139   | One switcher, tapped or Shift+Tab: Ask before edits, Accept edits, Plan. Auto and bypass are not in the cycle.                   |
| `[ ]` | `/model <name>`, `/effort <level>`                                   | Claude Agent     | #150   | Typed, with the reply in the conversation. The header follows a model change. The bare `/model` picker is terminal-only.         |
| `[ ]` | `/advisor`                                                           | Claude Agent     | #150   | Typed, it behaves as in the terminal and saves the owner's default. The Launch option never uses it.                             |
| `n/a` | `/fast`                                                              | Out of scope     | -      | See Fast mode in Tier 1.                                                                                                         |
| `n/a` | `/permissions`: view the rules                                       | Out of scope     | -      | No public SDK API. Route: Open in terminal.                                                                                      |
| `[ ]` | `/permissions`: change the rules                                     | Claude Agent     | #146   | Through "Yes, don't ask again", or by editing the settings files.                                                                |
| `[ ]` | `/reload-plugins`, `/reload-skills`                                  | Claude Agent     | #150   | Typed. If the SDK answers "isn't available", it shows as an Unsupported row (#153).                                              |
| `[ ]` | `/init`, `/code-review`, `/security-review` and other bundled skills | Claude Agent     | #150   | Prompts handed to Claude.                                                                                                        |
| `[ ]` | `/mcp`                                                               | Open in terminal | -      | A typed `/mcp` may print a text summary (#150). Reconnecting servers and signing in to one are for the terminal.                 |
| `[ ]` | `/agents`, `/skills` panel                                           | Open in terminal | -      | The `/` menu (#150) lists skills.                                                                                                |
| `[ ]` | `/config key=value`                                                  | Open in terminal | -      | May work typed. Not confirmed.                                                                                                   |
| `n/a` | The `/config` panel and `/status`                                    | Out of scope     | -      | Route: Open in terminal. The header shows the `claude` version, model and folder (#136).                                         |
| `n/a` | `/hooks`, `/memory`                                                  | Out of scope     | -      | No public SDK API. Route: Open in terminal, or edit the files.                                                                   |
| `n/a` | `/add-dir`, `/cd`                                                    | Out of scope     | -      | Mid-session changes have no public SDK API. Route: Open in terminal, or start a Workspace on the other folder.                   |
| `n/a` | `/plugin`                                                            | Out of scope     | -      | Answers "isn't available in this environment". Route: `claude plugin` in a shell Session, or Open in terminal.                   |
| `n/a` | `/login`, `/logout`                                                  | Out of scope     | -      | k-bench never holds, asks for or passes on credentials, and has no API-key path. Route: log in with `claude` in a shell Session. |

## Tier 3: terminal-only cosmetics

Dropped. They shape the terminal's own screen, which a Claude Agent doesn't have.

| Done  | Capability                                           | Where        | Ticket | Notes                                                     |
| :---- | :--------------------------------------------------- | :----------- | :----- | :-------------------------------------------------------- |
| `n/a` | Vim mode                                             | Out of scope | -      | Route: Open in terminal.                                  |
| `n/a` | Keybindings (`/keybindings`)                         | Out of scope | -      | Terminal input only. Route: Open in terminal.             |
| `n/a` | Terminal themes (`/theme`)                           | Out of scope | -      | A terminal's own colours.                                 |
| `n/a` | The status line renderer (`/statusline`)             | Out of scope | -      | The Transcript has its own header and status line (#136). |
| `n/a` | `/terminal-setup`, `/tui`, `/scroll-speed`, `/color` | Out of scope | -      | They set up or tune a terminal.                           |

## Around the Claude Agent

Not capabilities of Claude TUI, but part of the line, so they are ticked here too.

| Done  | Capability                                                          | Where        | Ticket     | Notes                                                                                                                            |
| :---- | :------------------------------------------------------------------ | :----------- | :--------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `[x]` | Idle, Working and Waiting for you on the row and the Pane's top bar | Claude Agent | #142       | Only Waiting for you pulses. A collapsed Workspace shows orange when any Agent inside waits.                                     |
| `[x]` | The Bell as a pulsing row, for every kind of Session                | Claude Agent | #131       | Replaces the bell badge.                                                                                                         |
| `[x]` | A Claude Agent raises the Bell                                      | Claude Agent | #145       | When a turn finishes or it becomes Waiting for you, only while no device is viewing it, cleared by viewing it anywhere.          |
| `[ ]` | Stop, Restart, and the Stopped Transcript                           | Claude Agent | #144       | Stopped keeps the whole conversation read-only, with the reason. A crash is never restarted automatically.                       |
| `[ ]` | Deleting a Claude Agent or its Workspace removes its log and files  | Claude Agent | #133, #144 | The reconciler removes any Agent folder with no Session row.                                                                     |
| `[ ]` | Updating k-bench under a running Agent                              | Claude Agent | #158       | Leaves it untouched. "Update available" only when the runtime changed. A protocol mismatch shows a Restart that resumes.         |
| `[ ]` | The Unsupported list beside the Claude Agent settings               | Claude Agent | #154       | Every unsupported kind seen, with a count, when it last happened and a link to the Session. Clearing an entry lets it come back. |
| `[ ]` | Taking "(WIP)" off                                                  | Claude Agent | #161       | Only when the line is met, after a live check by hand on the owner's real `claude`.                                              |
| `n/a` | Retiring Claude TUI                                                 | Out of scope | -          | It stays alongside Claude Agent indefinitely, and is the route for everything outside the line.                                  |
| `n/a` | Voice input, conversation search, push notifications                | Out of scope | -          | Route: none.                                                                                                                     |
| `n/a` | Idle, Working and Waiting for you for shells and Claude TUIs        | Out of scope | -          | They keep their terminal-bell and attach-based rules.                                                                            |
| `n/a` | Full parity beyond the line                                         | Out of scope | -          | A later map.                                                                                                                     |

## Folder trust

Claude Code asks whether you trust a folder the first time it opens in it. The SDK, which a Claude Agent runs on, never shows that dialog. What that means, accepted by the owner and recorded here and in the guide:

- In a folder Claude Code has never trusted, **project permission allow rules are ignored**, so the Agent may ask for things the terminal would let through.
- Project `.mcp.json` servers **connect without the approval prompt**, and project **hooks run**.
- Claude Code's own trust warning is shown in the conversation when one appears (#148).
- **The first Open in terminal in a folder Claude Code has never opened shows the trust dialog in the terminal.** A folder first opened by a Claude Agent has, in Claude Code's eyes, never been opened.
- k-bench does not detect trust itself, because that would mean reading Claude Code's private files.

## Keeping this list honest

The live check on a real `claude`, run by hand on the cheapest model before "(WIP)" comes off (#161), walks the rows above that depend on it. When an SDK or `claude` upgrade changes a row's route, change the row and say why in its Notes.
