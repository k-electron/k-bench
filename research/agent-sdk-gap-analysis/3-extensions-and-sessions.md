# Gap analysis, extensions and sessions slice: k-bench vs the Agent SDK docs

**Scope:** I read the 11 SDK doc pages I was given, `docs/internals/agent.md`, `docs/claude-agent-parity.md`, `src/agent-runtime/*`, `web/src/agent/*`, the agent components and `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (0.3.325). I changed nothing.

**Main finding:** besides `query()`, the runtime calls only a few SDK functions: `interrupt`, `stopTask`, `setPermissionMode`, `getContextUsage`, `supportedCommands`, `initializationResult`/`accountInfo`, and the standalone `getSessionMessages` for the Open in web import. A grep finds no use of `rewindFiles`, `mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `reloadPlugins`, `supportedAgents`, `backgroundTasks`, `forkSession`, `resumeSessionAt`, `listSessions`, `getSubagentMessages`, `forwardSubagentText` or `includeHookEvents`.

## Partial / Not handled (worst first)

**1. Restore code from the web**

- **Capability:** file-checkpointing.md, "Implement checkpointing" and "Multiple restore points"; `Query.rewindFiles(id, {dryRun})` at sdk.d.ts:3331.
- **Status:** Partial. Everything it needs is already in place: checkpointing is on (session.ts:138), user messages are replayed (session.ts:72), and each prompt's `id` is sent as its `uuid` (session.ts:226-232), so each logged prompt can be a restore point. But the protocol has no rewind message and the runtime never calls `rewindFiles`.
- **Owner sees/misses:** to undo the Agent's edits they must Open in terminal, which stops the Agent and any turn running, and then use the TUI's `/rewind` picker, which is awkward on a phone. The live `Query` can rewind with no restart, and `dryRun` returns `filesChanged`, `insertions` and `deletions` for a confirm dialog.
- **Caveats a UI must show:**
  - Only Write, Edit and NotebookEdit changes in the main conversation are tracked.
  - Subagent edits are not tracked, and subagents now run in the background by default. Bash edits are not tracked either.
  - Only a prompt that starts a turn is a checkpoint, so a prompt folded into a running turn gives `canRewind: false`.
  - Checkpoints belong to their own session, so prompts above a `/clear` divider cannot be rewound.
- **Severity:** High.

**2. Subagent work is invisible (no nested transcript)**

- **Capability:** subagents.md, "Detect subagent invocation"; `forwardSubagentText` at sdk.d.ts:2000; `getSubagentMessages` at sdk.d.ts:1009.
- **Status:** Not handled.
  - `forwardSubagentText` is never set (session.ts:131-155).
  - items.ts:368 drops every message that has `parent_tool_use_id`, including the subagent tool_use/tool_result frames that are already in the log.
  - live.ts:24 drops subagent text fragments.
- **Owner sees/misses:** one line per subagent, with counts, the last tool used and the final summary (tasks.ts:122-139). They can't see what it read or edited, or its reasoning. `task_notification.output_file` (sdk.d.ts:6624) is never shown. With background-by-default subagents (subagents.md, "Choose whether Claude waits"), a large share of the work happens out of sight.
- **Severity:** High.

**3. Rewind or branch the conversation**

- **Capability:** sessions.md, "Fork to explore alternatives"; `resumeSessionAt` (sdk.d.ts:2240), `resumeDropsTurn` (sdk.d.ts:2291, a validation guard), `forkSession` (sdk.d.ts:1840, :902).
- **Status:** Not handled. The parity doc marks it Out of scope because "summarize has no public SDK API". That is true for summarize, but restoring the conversation does have a public route: restart the runtime with `resume` plus `resumeSessionAt`, optionally with `forkSession`, then write a divider into the append-only log.
- **Owner sees/misses:** no way to take back a bad turn, or to try an alternative while keeping the original, without the terminal.
- **Severity:** Medium.

**4. Which subagent is asking for permission**

- **Capability:** subagents.md and the permission asks.
- **Status:** Partial. `agentId` is logged (asks.ts:127), but nothing in `PermissionPrompt`, `AskPanel` or `PromptDock` reads it. Because the subagent's own tool call is hidden (items.ts:368), the `⎿ permission` and "Not answered" lines have no tool line to sit under.
- **Owner sees/misses:** an ask from a background subagent, possibly while the main Agent is Idle, looks as if the main Claude asked. With several subagents running, they can't tell which one wants to run a command.
- **Severity:** Medium.

**5. Live MCP server status**

- **Capability:** mcp.md, "Error handling" and "Connection timing"; `mcpServerStatus()` at sdk.d.ts:3209.
- **Status:** Partial. Only `init.mcp_servers` is read, once per turn, and `pending` is ignored (uncommon.ts:327-359). The `error` text is not shown, and there is no list of servers.
- **Owner sees/misses:**
  - Tool search is on by default, so servers from settings and plugins usually show `pending` at init. A failure or "needs sign-in" shows up only in a later turn's init, if ever.
  - A server that drops mid-session goes pending, then failed, with nothing shown between turns.
- **Severity:** Medium.

**6. Reconnect or enable/disable an MCP server**

- **Capability:** mcp.md, "Error handling"; `reconnectMcpServer` (sdk.d.ts:3360) and `toggleMcpServer` (sdk.d.ts:3368).
- **Status:** Not handled. The parity doc sends it to Open in terminal (`/mcp`).
- **Owner sees/misses:** a failed server means stopping the Agent to fix it, even though each fix is a single SDK call.
- **Severity:** Medium.

**7. MCP sign-in (OAuth)**

- **Capability:** mcp.md, "OAuth2 authentication". The SDK runs no OAuth flow, and sdk.d.ts has no MCP auth API.
- **Status:** Not handled. The "MCP servers need sign-in" line (UncommonLine.tsx:140-148) has no action at all, not even Open in terminal, which Unsupported rows do offer.
- **Owner sees/misses:** a warning with nothing to tap. The route is to sign in from an interactive Claude Code session. Then a web Reconnect (item 6) could pick the server up without a restart; this is inferred, not checked.
- **Severity:** Medium.

**8. MCP elicitation**

- **Capability:** `ElicitationRequest` with `mode: 'form' | 'url'` (sdk.d.ts:782); `onElicitation` (sdk.d.ts:1882).
- **Status:** Partial. The runtime auto-declines and records it (session.ts:146-149), and the browser shows an Unsupported row with Open in terminal (unsupported.ts:226-239).
- **Owner sees/misses:** the decline is final. By the time they open the terminal the request has already failed, so no dialog is waiting there; Claude has to try again. URL mode (open a link, often for sign-in) and flat form mode would both fit the existing docked panel.
- **Severity:** Medium.

**9. Non-text and oversized MCP tool results**

- **Capability:** custom-tools.md, "Return images and resources"; mcp.md, "Tool output exceeds maximum allowed tokens".
- **Status:** Partial. `contentLines` (toolDisplay.ts:169-176) turns image blocks into the text `[image]` and drops resource, resource_link and audio blocks, so a result can read "(No content)". When Claude Code saves an oversized result to a file and returns an error naming it, the tool shows as red Failed.
- **Owner sees/misses:** on a phone they can't see a screenshot Claude took through Playwright or Figma.
- **Severity:** Medium.

**10. Hook output from tool and stop events (outside this slice)**

- **Capability:** claude-code-features.md, "Hooks"; `includeHookEvents` defaults to false (sdk.d.ts:1988).
- **Status:** Not handled. Only SessionStart and Setup hooks emit `hook_*` messages. The hook line (uncommon.ts:378) never sees PreToolUse, PostToolUse, Stop or UserPromptSubmit output.
- **Owner sees/misses:** hook warnings and `systemMessage`s are silent in the web, though the internals doc implies they are shown. This needs a live check.
- **Severity:** Medium.

**11. Open an existing conversation as an Agent**

- **Capability:** sessions.md, "Resume by ID"; `listSessions` (sdk.d.ts:1187).
- **Status:** Not handled. `NewSessionDialog` has no resume option, and the parity doc marks `/resume` out of scope.
- **Owner sees/misses:** a conversation started in a terminal outside k-bench, or the one a `/clear` left behind, can't be brought into the web. `listSessions({dir: <workspace folder>})` would make a picker cheap.
- **Severity:** Medium-Low.

**12. Plugin load errors**

- **Capability:** plugins.md, "Verifying plugin installation"; `init.plugins` and `init.plugin_errors` (sdk.d.ts:6555).
- **Status:** Not handled. Neither field is read anywhere. `plugin_install` messages are recognised but show nothing (unsupported.ts:84).
- **Owner sees/misses:** a broken plugin's skills, agents and hooks are silently missing.
- **Severity:** Low-Medium.

**13. Send a foreground task to the background**

- **Capability:** `backgroundTasks(toolUseId?)` (sdk.d.ts:3446), the terminal's Ctrl+B.
- **Status:** Not handled.
- **Owner sees/misses:** a foreground Bash command or subagent that blocks the turn can only be interrupted, which kills it.
- **Severity:** Low-Medium.

**14. Skill and Agent tool lines**

- **Capability:** skills.md, "How skills work".
- **Status:** Partial. `toolTarget` falls back to a fixed list of input keys (toolDisplay.ts:79). The Skill tool's input key is `skill`; that is inferred, since sdk-tools.d.ts has no Skill type. So the line most likely reads a bare `Skill`. The skill's loaded text is `is_meta` and hidden (items.ts:537). The Agent line shows the description but not `subagent_type`.
- **Owner sees/misses:** which skill Claude loaded, and which kind of subagent it started.
- **Severity:** Low.

**15. Output styles**

- **Capability:** modifying-system-prompts.md, "Output styles"; `init.output_style` (sdk.d.ts:6541); `reloadOutputStyles` (sdk.d.ts:3316).
- **Status:** Partial. The style is applied from settings, but the header never shows it. Whether a typed `/output-style` works was not checked. A style file created mid-session isn't seen until a Restart.
- **Severity:** Low.

**16. List of subagents and plugins (`/agents`, `/skills` panels)**

- **Capability:** `supportedAgents()` (sdk.d.ts:3203); `init.agents` and `init.plugins`.
- **Status:** Partial. The `/` menu lists commands and skills (commands.ts:39-91). Nothing lists the subagents or loaded plugins.
- **Severity:** Low.

**17. Session title sync**

- **Capability:** sessions.md, last paragraph; `renameSession` (sdk.d.ts:3469).
- **Status:** Not handled. Renaming a k-bench Session (service.ts:390) leaves Claude Code's own title unchanged, so the terminal's resume picker doesn't show k-bench's name. A typed `/rename` does work.
- **Severity:** Low.

**18. ToolSearch result line**

- **Capability:** tool-search.md.
- **Status:** Not checked. The result probably has no text blocks, so the line would read "(No content)".
- **Severity:** Low.

## Opportunity

- **In-process k-bench tools (custom-tools.md):** the runtime could pass a `createSdkMcpServer` to its `query()`, giving the owner's Claude tools such as:
  - `notify`: raise the Bell with a message;
  - `show`: display an image, HTML or markdown file in the Pane, sandboxed;
  - `send_file`: hand a file to the phone;
  - `needs_terminal`: ask the owner to do something in a terminal.

  Points to settle:
  - These tools disappear after Open in terminal; the conversation history still mentions them, which is harmless.
  - Calls would go through `canUseTool` unless annotated or allowed.
  - It breaks the Tier 1 rule that a Claude Agent's toolset matches the terminal's.
  - The first turn waits for an in-process server to connect, which is quick.
- **MCP Apps widgets:** `readMcpResource` (sdk.d.ts:3381, marked alpha) would let the web show a tool's `ui://` widget in a sandbox. Low.

## N/A for an operator

- **SessionStore and external storage** (session-storage.md): single Mac, and the SDK throws if it is combined with `enableFileCheckpointing` or `persistSession: false`.
- **`continue: true`:** k-bench tracks conversation IDs explicitly.
- **Programmatic `agents` / `skills` / `plugins` options, `settingSources` choices, tool-search tuning:** k-bench deliberately runs the owner's own configuration.
- **`systemPrompt.append`:** it would make the Agent differ from the terminal.
- **`agentProgressSummaries`:** left off on purpose because of its cost (internals doc line 128).
- **Agent teams:** the SDK cannot configure them.

## Handled (one line each)

- `settingSources` left unset and the `claude_code` preset set (session.ts:131-136): CLAUDE.md, skills, plugins, hooks, MCP and `.claude/agents` load as in the terminal.
- `sessionId` for a new conversation and `resume` for a Restart (session.ts:151-153); a never-saved conversation starts fresh.
- The conversation ID follows `/clear` (main.ts:97, `conversationOf`).
- The `/` menu comes from `supportedCommands`, is replaced by `commands_changed`, and hides terminal-only commands (commands.ts:39-91).
- A command that "isn't available in this environment" and terminal-only commands become Unsupported rows (unsupported.ts:140-162, 246-263).
- Per-task Stop, and interrupt sparing background tasks via `perTaskStopAffordance` (session.ts:143, tasks.ts).
- Importing terminal turns via `getSessionMessages` (main.ts:179).
- MCP `failed` and `needs-auth` at init become a line (uncommon.ts:327-359), and MCP tool names display as `server - tool (MCP)` (toolDisplay.ts:88-92).
- File checkpointing is on from the first launch (session.ts:138).

## Docs vs installed types

- Every API the docs name is present in the 0.3.325 types: `listSessions`, `getSessionInfo`, `renameSession`, `tagSession`, `deleteSession`, `forkSession`, `listSubagents`, `getSubagentMessages`, `startup`, `InMemorySessionStore`, `reloadPlugins({addPlugins})`, `agent_id`, `omitClaudeMd`, `autoCompactWindow`.
- The types also have things the docs don't mention: `resumeDropsTurn`, `backgroundTasks`, `reloadOutputStyles`, `readMcpResource`, `init.plugin_errors` and `init.effort`.
- ~~`init.effort` (sdk.d.ts:6580) contradicts the parity doc~~ **Corrected on review:** the type's own doc says the field is present only on Remote Control bridge init frames, so the parity doc stands. Applied effort is readable through `get_settings`, which is not in the public types.
- Neither the docs nor the types offer an MCP OAuth API.
- sdk-tools.d.ts has no Skill tool input type.

## The 5 most important gaps

1. **Code rewind from the web (High).** The prerequisites are already in place: checkpointing is on and each logged prompt can serve as a restore point. The only thing missing is a `rewind_files {promptId, dryRun}` message calling `Query.rewindFiles`, which works without a restart. Today undoing the Agent's edits means stopping it and using the terminal's `/rewind`; the UI must say that subagent and Bash edits aren't covered.
2. **Subagent transcripts (High).** Subagents now run in the background by default, and k-bench shows each one as a single progress line. It drops even the subagent tool_use/tool_result frames already in its log. Turning on `forwardSubagentText`, or just rendering the logged frames under the task line, would let the owner see what subagents do.
3. **MCP status and control (Medium).** Status is read only from each turn's `init`, `pending` is ignored, and nothing is followed mid-session. Failed servers and sign-ins offer no action. Polling `mcpServerStatus()` and adding Reconnect and Enable/disable buttons (`reconnectMcpServer`, `toggleMcpServer`) would remove most of the terminal trips for `/mcp`.
4. **Subagent permission asks are anonymous (Medium).** The subagent's `agentId` is logged but never shown, and the subagent's tool call is hidden. So an ask from a background subagent looks like the main Claude asking about nothing on screen. Naming the subagent on the panel, and giving its call a line, closes this.
5. **Elicitation and non-text MCP output (Medium).** Elicitation is declined before the owner can act, so Open in terminal comes too late; URL and simple form modes would fit the existing docked panel. Separately, MCP image and resource results show as `[image]` or nothing, so screenshots Claude takes can't be seen on the phone.
