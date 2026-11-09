Throwaway spike for "what keeps an Agent Runtime alive across a k-bench restart?". Never merged.

`pnpm install`, then `node scenario.mjs <tmux|launchd|detached|plain> <bootoutswap|kickstart|kill9|killrt> <1|0>`
(last argument: 1 = the parent job has `AbandonProcessGroup`, 0 = it does not). It loads a stand-in
parent LaunchAgent, has it start a runtime (`runtime.mjs`), starts a ~75 s Bash turn through
the Agent SDK, restarts the parent mid-turn, and records what survived. Needs `claude` at
`~/.local/bin/claude` and a login that works. One run costs about $0.005 of haiku. Sockets go in `/tmp/kbs`.
