# Live check results

- mode: the installed claude
- claude version: 2.1.329; Agent SDK 0.3.325
- model: Haiku, effort low, on every query (the first init of each session was checked)
- date: 2026-11-20
- model turns spent: 10 of 15
- settings files byte-identical after the run: yes
- claude processes left running (killed): 0
- cleaned up: the conversations saved for the throwaway folder; file-history of a conversation of this run; session-env of a conversation of this run; session-env of a conversation of this run; session-env of a conversation of this run; task output files of the throwaway folder

## Verdicts

| Check             | Row | Verdict      |
| ----------------- | --- | ------------ |
| subagent-messages | A3  | FAIL         |
| subagent-ask      | A3  | PASS         |
| rewind-files      | A3  | PASS         |
| ctrl-b-bash       | A3  | NOT PROVOKED |
| ctrl-b-agent      | A3  | NOT PROVOKED |

## Details

### subagent-messages: FAIL

Subagent frames with and without forwardSubagentText, getSubagentMessages, listSubagents, task_notification.output_file.

- with forwardSubagentText off, subagent text or thinking still arrived
- assumption in the code: web/src/agent/items.ts (drops every message with parent_tool_use_id); src/agent-runtime/session.ts (forwardSubagentText unset); sdk.d.ts forwardSubagentText docs
- forwardSubagentText on, kb-writer (foreground): 4 messages with parent_tool_use_id (3276 bytes), 0 stream_event (0 bytes); shapes user[text]×1, assistant[tool_use]×1, user[tool_result]×1, assistant[text]×1; agent_id equals the task_id on each: yes; text or thinking blocks: yes; models haiku
- forwardSubagentText on, kb-writer: task_notification {"status":"completed","summaryChars":4,"usage":{"total_tokens":1806,"tool_uses":1,"duration_ms":2823},"file":{"where":"/private/tmp/claude-501/-home-you-project/<session>/tasks/<id>.output","exists":true,"symlink":true,"target":"/home/you/.claude/projects/-home-you-project/<session>/subagents/agent-<id>.jsonl","bytes":25508,"lines":20,"jsonLines":20,"types":["user","attachment","api-request-shape","api-request-blob","api-request","assistant"],"holdsBashMarker":false,"holdsProbeLine":false}}
- forwardSubagentText on, kb-reader (background): 3 messages with parent_tool_use_id (2653 bytes), 0 stream_event (0 bytes); shapes assistant[tool_use]×1, user[tool_result]×1, assistant[text]×1; agent_id equals the task_id on each: yes; text or thinking blocks: yes; models haiku
- forwardSubagentText on, kb-reader: task_notification {"status":"completed","summaryChars":19,"usage":{"total_tokens":2187,"tool_uses":1,"duration_ms":2721},"file":{"where":"/private/tmp/claude-501/-home-you-project/<session>/tasks/<id>.output","exists":true,"symlink":true,"target":"/home/you/.claude/projects/-home-you-project/<session>/subagents/agent-<id>.jsonl","bytes":28342,"lines":20,"jsonLines":20,"types":["user","attachment","api-request-shape","api-request-blob","api-request","assistant"],"holdsBashMarker":false,"holdsProbeLine":true}}
- forwardSubagentText on: stored transcripts {"listed":2,"listedIncludes":[true,true],"messages:a8221c8428533c672":{"count":4,"bytes":3053,"shapes":["user[text]","assistant[tool_use]","user[tool_result]","assistant[text]"]},"messages:a5ff35aabc4a153d2":{"count":4,"bytes":2892,"shapes":["user[text]","assistant[tool_use]","user[tool_result]","assistant[text]"]}}
- forwardSubagentText off, kb-writer (foreground): 3 messages with parent_tool_use_id (2366 bytes), 0 stream_event (0 bytes); shapes user[text]×1, assistant[tool_use]×1, user[tool_result]×1; agent_id equals the task_id on each: yes; text or thinking blocks: yes; models haiku
- forwardSubagentText off, kb-writer: task_notification {"status":"completed","summaryChars":4,"usage":{"total_tokens":1805,"tool_uses":1,"duration_ms":2844},"file":{"where":"/private/tmp/claude-501/-home-you-project/<session>/tasks/<id>.output","exists":true,"symlink":true,"target":"/home/you/.claude/projects/-home-you-project/<session>/subagents/agent-<id>.jsonl","bytes":25433,"lines":20,"jsonLines":20,"types":["user","attachment","api-request-shape","api-request-blob","api-request","assistant"],"holdsBashMarker":false,"holdsProbeLine":false}}
- forwardSubagentText off, kb-reader (background): 3 messages with parent_tool_use_id (2668 bytes), 0 stream_event (0 bytes); shapes assistant[tool_use]×1, user[tool_result]×1, assistant[text]×1; agent_id equals the task_id on each: yes; text or thinking blocks: yes; models haiku
- forwardSubagentText off, kb-reader: task_notification {"status":"completed","summaryChars":19,"usage":{"total_tokens":2189,"tool_uses":1,"duration_ms":2638},"file":{"where":"/private/tmp/claude-501/-home-you-project/<session>/tasks/<id>.output","exists":true,"symlink":true,"target":"/home/you/.claude/projects/-home-you-project/<session>/subagents/agent-<id>.jsonl","bytes":28369,"lines":20,"jsonLines":20,"types":["user","attachment","api-request-shape","api-request-blob","api-request","assistant"],"holdsBashMarker":false,"holdsProbeLine":true}}
- forwardSubagentText off: stored transcripts {"listed":2,"listedIncludes":[true,true],"messages:ab9217067dc76fcbf":{"count":4,"bytes":3055,"shapes":["user[text]","assistant[tool_use]","user[tool_result]","assistant[text]"]},"messages:a47d197b17bcaa13f":{"count":4,"bytes":2895,"shapes":["user[text]","assistant[tool_use]","user[tool_result]","assistant[text]"]}}

### subagent-ask: PASS

A subagent's permission ask names the subagent (canUseTool agentID).

- every subagent ask carried agentID, equal to the subagent's task_id
- assumption in the code: src/agent-runtime/asks.ts logs agentId; nothing in the browser shows it
- subagents: a subagent's Write ask: agentID = the subagent's task_id (and agent_id)
- subagents: main-thread asks carry no agentID: yes
- rewind-files: a subagent's Write ask: agentID = the subagent's task_id (and agent_id)
- rewind-files: main-thread asks carry no agentID: yes
- ctrl-b: main-thread asks carry no agentID: yes

### rewind-files: PASS

rewindFiles on a live Query: dry run, real restore, a queued prompt, a prompt above /clear, Bash and subagent edits, a later turn.

- a real rewind on the live Query, without a restart, restored the file Write made
- assumption in the code: src/agent-runtime/session.ts enableFileCheckpointing + prompt id = message uuid; file-checkpointing.md
- the queued prompt was sent during U1's tool call: true; prompts completed 2 of 2 with 1 result(s)
- Bash part: run
- disk: start {"a.txt":"absent","a2.txt":"absent","b.txt":"absent","sub-off.txt":"absent"}; afterU1 {"a.txt":"v1","a2.txt":"x","b.txt":"absent","sub-off.txt":"absent"}; afterU4 {"a.txt":"v2","a2.txt":"x","b.txt":"b","sub-off.txt":"absent"}; afterU5 {"a.txt":"v2","a2.txt":"x","b.txt":"b","sub-off.txt":"sub"}; afterRewindU4 {"a.txt":"v1","a2.txt":"x","b.txt":"b","sub-off.txt":"sub"}; afterLaterTurn {"a.txt":"v3","a2.txt":"x","b.txt":"b","sub-off.txt":"sub"}; afterRewindU1 {"a.txt":"v3","a2.txt":"x","b.txt":"b","sub-off.txt":"sub"}
- dry runs before /clear: {"u1":{"canRewind":true,"files":["a.txt","a2.txt"],"insertions":0,"deletions":2,"keys":["canRewind","deletions","filesChanged","insertions"]},"u2":{"canRewind":false,"error":"No file checkpoint found for this message.","keys":["canRewind","error"]},"u4":{"canRewind":true,"files":["a.txt"],"insertions":1,"deletions":1,"keys":["canRewind","deletions","filesChanged","insertions"]},"u5":{"canRewind":true,"files":[],"insertions":0,"deletions":0,"keys":["canRewind","deletions","filesChanged","insertions"]}}
- real rewind to U4 (before the Bash edit and the subagents): {"canRewind":true,"skippedLinks":0,"keys":["canRewind","skippedLinks"]}
- dry run to U4 again right after: {"canRewind":true,"files":[],"insertions":0,"deletions":0,"keys":["canRewind","deletions","filesChanged","insertions"]}
- a later turn editing a.txt: {"tools":["Read","Edit"],"toolErrors":[],"reply":"v3"}
- /clear gave 1 result(s)
- dry runs after /clear: {"u1":{"canRewind":false,"error":"No file checkpoint found for this message.","keys":["canRewind","error"]},"u2":{"canRewind":false,"error":"No file checkpoint found for this message.","keys":["canRewind","error"]},"u4":{"canRewind":false,"error":"No file checkpoint found for this message.","keys":["canRewind","error"]},"u5":{"canRewind":false,"error":"No file checkpoint found for this message.","keys":["canRewind","error"]},"u6":{"canRewind":false,"error":"No file checkpoint found for this message.","keys":["canRewind","error"]}}
- real rewind to U1 after /clear: {"threw":"Error: No file checkpoint found for this message."}

### ctrl-b-bash: NOT PROVOKED

backgroundTasks(toolUseId) on a running foreground Bash command.

- the model did not run the foreground Bash command
- assumption in the code: not called by k-bench (gap analysis: no Ctrl+B)
- provoked: false
- tools: ["Bash"]

### ctrl-b-agent: NOT PROVOKED

backgroundTasks() on a running foreground subagent.

- the model did not run the foreground subagent
- assumption in the code: not called by k-bench (gap analysis: no Ctrl+B)
- provoked: false
- tools: ["Agent","Bash"]
