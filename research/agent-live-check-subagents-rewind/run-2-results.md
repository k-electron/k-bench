# Live check results

- mode: the installed claude
- claude version: 2.1.329; Agent SDK 0.3.325
- model: Haiku, effort low, on every query (the first init of each session was checked)
- date: 2026-11-20
- model turns spent: 3 of 5
- settings files byte-identical after the run: yes
- claude processes left running (killed): 0
- cleaned up: the conversations saved for the throwaway folder; session-env of a conversation of this run; task output files of the throwaway folder

## Verdicts

| Check        | Row | Verdict |
| ------------ | --- | ------- |
| ctrl-b-bash  | A3  | PASS    |
| ctrl-b-agent | A3  | PASS    |

## Details

### ctrl-b-bash: PASS

backgroundTasks() with no tool_use id (Ctrl+B) on a running foreground Bash command; rewindFiles mid-turn.

- the foreground Bash command went to the background and the turn ended before the task did
- assumption in the code: not called by k-bench (gap analysis: no Ctrl+B)
- provoked: true
- byToolUse: false
- tasksBeforeCall: [{"type":"local_bash","backgrounded":false}]
- returned: true
- toolResultMs: 1059
- toolResultText: "Command was manually <id> by user with ID: <id>. Output is being written to: /private/tmp/claude-501/-home-you-project/<id>/tasks/<id>.output. If it is still running after 30m in the <id>, it will be stopped and you will be notified."
- toolResultIsError: false
- toolUseResultKeys: ["backgroundTaskId","backgroundedByUser","interrupted","isImage","noOutputExpected","stderr","stdout"]
- toolUseResultStatus: undefined
- turnCompleted: true
- turnEndMs: 4922
- resultBeforeNotification: true
- afterCall: ["system/background_tasks_changed","system/task_updated","user[tool_result]","system/status","stream_event","system/thinking_tokens","assistant[thinking]","assistant[tool_use]","assistant[text]","result/success","command_lifecycle"]
- taskEvents: ["background_tasks_changed(1)","task_updated({\"is_backgrounded\":true})","task_updated({\"status\":\"completed\",\"end_time\":1795151787781})","task_notification(completed)"]
- notification: {"ms":13004,"status":"completed","namesTheToolUse":true,"file":{"where":"/private/tmp/claude-501/-home-you-project/<session>/tasks/<id>.output","exists":true,"symlink":false,"bytes":40,"lines":2,"jsonLines":0,"types":[],"holdsBashMarker":true,"holdsProbeLine":false}}
- rewindFiles mid-turn: {"dry":{"canRewind":true,"filesChanged":[],"insertions":0,"deletions":0,"ms":3},"real":{"canRewind":true,"skippedLinks":0,"ms":1},"turnStillRunning":true}

### ctrl-b-agent: PASS

backgroundTasks(the Agent call's tool_use id) on a running foreground subagent.

- the foreground subagent went to the background and the turn ended before the task did
- assumption in the code: not called by k-bench (gap analysis: no Ctrl+B)
- provoked: true
- byToolUse: true
- tasksBeforeCall: [{"type":"local_agent","backgrounded":false},{"type":"local_bash","backgrounded":false}]
- returned: true
- toolResultMs: 63
- toolResultText: "[{\"type\":\"text\",\"text\":\"Async agent launched <id>. (This tool result is internal metadata — never quote or paste any part of it, <id> the agentId below, into a user-facing reply.)\\nagentId: <id> (internal ID - do not mention to user. Use Se"
- toolResultIsError: false
- toolUseResultKeys: ["agentId","canContinueAgent","canReadOutputFile","description","isAsync","outputFile","prompt","resolvedModel","status"]
- toolUseResultStatus: "async_launched"
- turnCompleted: true
- turnEndMs: 2308
- resultBeforeNotification: true
- afterCall: ["system/background_tasks_changed","system/task_updated","user[tool_result]","system/status","stream_event","system/thinking_tokens","assistant[thinking]","assistant[text]","result/success","command_lifecycle"]
- taskEvents: ["background_tasks_changed(1)","task_updated({\"is_backgrounded\":true})","task_notification(completed)"]
- notification: {"ms":13008,"status":"completed","namesTheToolUse":false,"file":{"where":"","exists":false}}
