# Live check results

> **ABORTED:** stopped early, the run's turn budget (4) is spent: stopped at once

- mode: the installed claude
- claude version: 2.1.329; Agent SDK 0.3.325
- model: Haiku, effort low, on every query (the first init of each session was checked)
- date: 2026-11-20
- model turns spent: 4 of 4
- settings files byte-identical after the run: yes
- claude processes left running (killed): 0
- cleaned up: the conversations saved for the throwaway folder; session-env of a conversation of this run; session-env of a conversation of this run

## Verdicts

| Check               | Row | Verdict |
| ------------------- | --- | ------- |
| hook-events         | A3  | NOT RUN |
| hook-system-message | A3  | NOT RUN |
| hook-blocks         | A3  | NOT RUN |
| refusals            | A3  | NOT RUN |

## Details

### hook-events: NOT RUN

#177 Q1: which hook_* messages arrive for PreToolUse, PostToolUse, UserPromptSubmit and Stop, with includeHookEvents on and off.

- the turn budget ran out during its scenario (spent 4 of 4)
- assumption in the code: src/agent-runtime/session.ts ClaudeSession (includeHookEvents unset) with web/src/agent/uncommon.ts readSystem (the hook line reads hook_response)

### hook-system-message: NOT RUN

#177 Q1: where a hook's systemMessage arrives, and whether k-bench draws it as Claude's words.

- the turn budget ran out during its scenario (spent 4 of 4)
- assumption in the code: web/src/agent/items.ts buildItems, assistant case (no is_meta check), and web/src/agent/uncommon.ts hookLines (systemMessage read from a hook's JSON stdout)

### hook-blocks: NOT RUN

#177 Q1: how a hook's non-blocking error and a blocking reason arrive, and what k-bench draws.

- the turn budget ran out during its scenario (spent 4 of 4)
- assumption in the code: web/src/agent/uncommon.ts readSystem (hook_response outcome) and web/src/agent/items.ts resolveTool (a blocked tool's result)

### refusals: NOT RUN

#177 Q4: model_refusal_fallback / model_refusal_no_fallback shapes.

- the turn budget ran out during its scenario (spent 4 of 4)
- assumption in the code: web/src/agent/unsupported.ts (recognised) and web/src/agent/uncommon.ts readSystem (no reader)
