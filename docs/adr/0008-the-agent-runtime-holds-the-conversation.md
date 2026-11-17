# The Agent Runtime holds the conversation, and the server only relays it

A Claude Agent is viewed from several devices at once, through browsers that sleep and reconnect and a k-bench server that restarts and updates. Each Agent Runtime is the single holder of its conversation. It has the turn in progress and any unanswered Allow/Deny, and it writes every SDK message it sees, unchanged, to its own append-only log in the Agent's folder. It sends every connected client a replay from a sequence number, followed by everything live. The server checks access and then forwards each browser socket to the runtime's unix socket without reading what passes through. The browser turns SDK messages into what the owner sees. History comes from that log, never from the SDK's `getSessionMessages`.

## Considered Options

- **The server as hub.** One connection per runtime, with the conversation cached in the server and sent on to browsers. This puts conversation state back in the process that restarts most often, and a newer server would have to understand every older runtime's messages.
- **History from `getSessionMessages`.** It can't show a turn in progress, leaves out `tool_use_result`, returns only the chain after compaction, and has no documented gap-free join with live messages.
- **Rendering in the runtime.** A runtime keeps its version until the owner restarts it, so every display fix would wait for each Agent's restart. Rendering in the browser lands on the next page refresh.

## Consequences

- The runtime does the fan-out, so every connected device is an equal participant. The first answer to an Allow/Deny wins. A prompt waits as long as the runtime lives, whoever is connected, and is marked interrupted if the runtime dies.
- Each Claude Agent's log, socket and later its images live in one folder under the data directory, owner-only (`0700`). Deleting the Session removes the folder, and the reconciler removes any folder with no Session.
- The wire protocol has a number and only grows by additions. "Update available" means the runtime's own code changed, not just k-bench. A breaking change asks the owner to restart that Agent, which resumes its conversation.
- Turns taken while the conversation is open in a Claude TUI are not in the log.
