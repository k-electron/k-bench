### hook-events: FAIL (replayed)

#177 Q1: which hook_* messages arrive for PreToolUse, PostToolUse, UserPromptSubmit and Stop, with includeHookEvents on and off.

- with includeHookEvents unset (as k-bench launches) these hooks' hook_response never arrives, so the hook line in uncommon.ts never fires for them
- assumption in the code: src/agent-runtime/session.ts ClaudeSession (includeHookEvents unset) with web/src/agent/uncommon.ts readSystem (the hook line reads hook_response)
- option on: 33 hook_* messages: hook_started SessionStart:startup; hook_response SessionStart:startup success exit 0; hook_started UserPromptSubmit; hook_started UserPromptSubmit; hook_response UserPromptSubmit success exit 0 [ours]; hook_response UserPromptSubmit success exit 0; hook_started PreToolUse:Read; hook_response PreToolUse:Read success exit 0 [ours]; hook_started PostToolUse:Read; hook_started PostToolUse:Read; hook_started PostToolUse:Read; hook_response PostToolUse:Read error exit 1 [ours]; hook_response PostToolUse:Read success exit 0 [ours]; hook_response PostToolUse:Read success exit 0; hook_started Stop; hook_started Stop; hook_response Stop success exit 0 [ours]; hook_response Stop success exit 0; hook_started UserPromptSubmit; hook_started UserPromptSubmit; hook_response UserPromptSubmit success exit 0 [ours]; hook_response UserPromptSubmit success exit 0; hook_started PreToolUse:Glob; hook_started PreToolUse:Grep; hook_response PreToolUse:Glob error exit 2 [ours]; hook_response PreToolUse:Grep success exit 0 [ours]; hook_started Stop; hook_started Stop; hook_response Stop success exit 0 [ours]; hook_response Stop success exit 0; hook_started UserPromptSubmit; hook_started UserPromptSubmit; hook_response UserPromptSubmit success exit 0 [ours]
- option off: 2 hook_* messages: hook_started SessionStart:startup; hook_response SessionStart:startup success exit 0
- our hook_response events, on: PreToolUse, PostToolUse, UserPromptSubmit, Stop; off: none
- hook lines k-bench draws with the option on: 14 (the owner's own hooks: 6, as SessionStart:startup success; UserPromptSubmit success; PostToolUse:Read success; Stop success; UserPromptSubmit success; Stop success); with it off: 1

### hook-system-message: PASS (replayed)

#177 Q1: where a hook's systemMessage arrives, and whether k-bench draws it as Claude's words.

- no hook systemMessage is drawn as Claude's words
- assumption in the code: web/src/agent/items.ts buildItems, assistant case (no is_meta check), and web/src/agent/uncommon.ts hookLines (systemMessage read from a hook's JSON stdout)
- option on, UserPromptSubmit systemMessage: arrives in system/hook_response x2, system/informational x2; drawn as hook UserPromptSubmit (success), notice, hook UserPromptSubmit (success), notice
- option on, PreToolUse systemMessage: arrives in system/hook_response x1, system/informational x1; drawn as hook PreToolUse:Read (success), notice
- option on, Stop systemMessage: arrives in system/hook_response x2, system/informational x2; drawn as hook Stop (success), notice, hook Stop (success), notice
- option off, UserPromptSubmit systemMessage: arrives in system/informational x1; drawn as notice
- option off, PreToolUse systemMessage: arrives in system/informational x1; drawn as notice
- option off, Stop systemMessage: arrives in system/informational x1; drawn as notice

### hook-blocks: FAIL (replayed)

#177 Q1: how a hook's non-blocking error and a blocking reason arrive, and what k-bench draws.

- these arrive but k-bench draws nothing that holds their text: PreToolUse JSON deny on Grep (blocking) (option on)
- assumption in the code: web/src/agent/uncommon.ts readSystem (hook_response outcome) and web/src/agent/items.ts resolveTool (a blocked tool's result)
- option on, PostToolUse exit 1 (non-blocking error): arrives in system/hook_response x1; drawn as hook PostToolUse:Read (error)
- option on, PostToolUse plain stdout: arrives in system/hook_response x1; drawn as hook PostToolUse:Read (success)
- option on, PreToolUse exit 2 on Glob (blocking): arrives in system/hook_response x1, user x1; drawn as hook PreToolUse:Glob (error)
- option on, PreToolUse JSON deny on Grep (blocking): arrives in system/hook_response x1, user x1; drawn as nothing
- option on, UserPromptSubmit decision block: arrives in system/hook_response x1, system/informational x1, result/success x1; drawn as notice
- option off, PostToolUse exit 1 (non-blocking error): arrives in nothing; drawn as nothing
- option off, PostToolUse plain stdout: arrives in nothing; drawn as nothing
- tools Claude called (option on): Read, Glob, Grep
- the blocked prompt: 1 result(s) (subtype success, is_error false, num_turns 0)

### refusals: NOT PROVOKED (replayed)

#177 Q4: model_refusal_fallback / model_refusal_no_fallback shapes.

- not provoked on purpose: a refusal needs a prompt the model refuses (a safety category), which the check does not send
- assumption in the code: web/src/agent/unsupported.ts (recognised) and web/src/agent/uncommon.ts readSystem (no reader)
