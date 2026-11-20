# Live check results

- mode: the installed claude
- claude version: 2.1.329; Agent SDK 0.3.325
- model: Haiku, effort low, on every query (the first init of each session was checked)
- date: 2026-11-20
- model turns spent: 3 of 9
- settings files byte-identical after the run: yes
- claude processes left running (killed): 0
- cleaned up: the conversations saved for the throwaway folder; session-env of a conversation of this run; session-env of a conversation of this run; session-env of a conversation of this run; session-env of a conversation of this run

## Verdicts

| Check            | Row | Verdict |
| ---------------- | --- | ------- |
| owner-hook-lines | A3  | FAIL    |
| start-mode       | A3  | FAIL    |
| denial-shape     | A3  | FAIL    |
| rate-limit       | A3  | PASS    |

## Details

### owner-hook-lines: FAIL

#177 Q1: what the owner's own hooks would draw on one plain turn with includeHookEvents on.

- with the option on, the owner's successful hooks draw a line on every plain turn (what the terminal shows for them was not checked here)
- assumption in the code: web/src/agent/uncommon.ts readSystem hook_response (a hook that printed anything is a line, whatever its outcome)
- hook_response messages: 3 (SessionStart:startup success; UserPromptSubmit success; Stop success)
- of them printed something: 3; stdout that is JSON: 3
- hook lines drawn: 2 (UserPromptSubmit success, 1 line(s); Stop success, 1 line(s))
- notices drawn: 0

### start-mode: FAIL

#177 Q2: the mode an Agent starts in with no permissionMode, against the TUI's.

- the Agent starts in another mode than the terminal for the same settings
- assumption in the code: src/agent-runtime/session.ts ClaudeSession (permissionMode unset) and ClaudeSession.permissionMode (current_permission_mode)
- owner's permissions.defaultMode: {"settings.json":"absent","settings.local.json":"no file"}
- SDK, no permissionMode, model haiku, canUseTool set (as k-bench): current_permission_mode default; the first turn's init.permissionMode default
- SDK, no permissionMode, model haiku, no canUseTool: current_permission_mode default
- TUI, no --permission-mode, model haiku: footer "auto mode on" (auto)
- models: default: supportsAutoMode true; opus: supportsAutoMode true; fable: supportsAutoMode true; sonnet: supportsAutoMode true; haiku: supportsAutoMode true; claude-fable-5-1: supportsAutoMode true; claude-haiku-4-5-20251001: supportsAutoMode absent; claude-sonnet-5: supportsAutoMode true; claude-opus-5: supportsAutoMode true; claude-fable-5: supportsAutoMode true; claude-opus-4-8: supportsAutoMode true; claude-opus-4-7: supportsAutoMode true; claude-opus-4-6: supportsAutoMode true; claude-sonnet-4-6: supportsAutoMode true

### denial-shape: FAIL

#177 Q3: what permission_denied carries for a deny rule and for dontAsk, and the tool result beside it.

- a denial's reason arrives but k-bench draws it nowhere
- assumption in the code: web/src/agent/uncommon.ts readSystem (permission_denied falls through, nothing drawn) and web/src/agent/items.ts resolveTool (a refused tool is `failed` with its text, or `Denied`)
- deny rule: tools called ToolSearch, WebFetch; canUseTool asked 0 time(s)
- deny rule: permission_denied keys [decision_reason_type, message, session_id, subtype, tool_name, tool_use_id, type, uuid]; tool_name WebFetch; decision_reason_type rule; decision_reason absent; message "WebFetch denied access to domain:example.com."
- deny rule: tool_result beside it: is_error true, text identical to message
- deny rule: k-bench draws the message as nothing
- deny rule: result.permission_denials 1 (keys tool_input, tool_name, tool_use_id); terminal_reason completed
- deny rule: tool items ToolSearch done ((No content)), WebFetch denied (Denied)
- dontAsk: tools called Write; canUseTool asked 0 time(s)
- dontAsk: permission_denied keys [decision_reason_type, message, session_id, subtype, tool_name, tool_use_id, type, uuid]; tool_name Write; decision_reason_type mode; decision_reason absent; message "Permission to use Write has been denied because Claude Code is running in don't ask mode. IMPORTANT: You _may_ attempt to accomplish this action using other tools that might naturally be used to accom"
- dontAsk: tool_result beside it: is_error true, text identical to message
- dontAsk: k-bench draws the message as nothing
- dontAsk: result.permission_denials 1 (keys tool_input, tool_name, tool_use_id); terminal_reason completed
- dontAsk: tool items Write denied (Denied)

### rate-limit: PASS

#177 Q5: the rate_limit_event of a normal turn: fields, utilization range, overage fields.

- 3 event(s), status allowed
- assumption in the code: web/src/agent/uncommon.ts readRateLimit (only allowed_warning and rejected are a line)
- event 1: isUsingOverage false, overageDisabledReason org_level_disabled, overageStatus rejected, rateLimitType five_hour, resetsAt in under 6h, status allowed, unifiedWindows {five_hour {resetsAt in under 6h, status allowed, utilization 0.1-0.2}, seven_day {resetsAt in 6-48h, status allowed, utilization 0.4-0.5}}
- event 2: isUsingOverage false, overageDisabledReason org_level_disabled, overageStatus rejected, rateLimitType five_hour, resetsAt in under 6h, status allowed, unifiedWindows {five_hour {resetsAt in under 6h, status allowed, utilization 0.1-0.2}, seven_day {resetsAt in 6-48h, status allowed, utilization 0.4-0.5}}
- event 3: isUsingOverage false, overageDisabledReason org_level_disabled, overageStatus rejected, rateLimitType five_hour, resetsAt in under 6h, status allowed, unifiedWindows {five_hour {resetsAt in under 6h, status allowed, utilization 0.1-0.2}, seven_day {resetsAt in 6-48h, status allowed, utilization 0.4-0.5}}
