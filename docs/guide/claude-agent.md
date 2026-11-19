# Claude Agent (WIP)

A **Claude Agent** is a Claude Session that you operate from k-bench's own web interface instead of through a terminal. It is marked **(WIP)** everywhere it is offered, on every install, because it is a work in progress: it is not yet the way to spend a whole working day with Claude, and the label comes off only when it is. The [parity checklist](../claude-agent-parity.md) lists every capability of Claude Code's terminal interface and says which ones a Claude Agent already does, which go through Open in terminal, and which are out of scope. If something here is missing, look there first.

A [Claude Session](claude-code.md) operated through Claude Code's own terminal interface is a **Claude TUI**. It keeps working exactly as before, and it stays alongside Claude Agent.

## What it is

A Claude Agent shows the conversation as a **Transcript** in the Pane instead of a terminal. It is built for a phone as much as for a desktop:

- Claude's replies stream in, with prose in a reading font and real markdown. Tool output collapses, edits show as coloured diffs, and thinking is one muted line. With **Focus view** chosen when you create the Session, each tool call is a single line, with no output.
- You type into an ordinary input box. On a phone there are no Extra keys, and the keyboard's own typing aids work.
- A line under the input shows the permission mode, the same on every device. Tap it, or press Shift+Tab in the input on a desktop, to go through Ask before edits, Accept edits and Plan mode. A mode Claude Code changes itself, such as leaving plan mode, shows there too.
- While Claude works you can keep typing: each message goes straight to Claude Code and shows "(queued)" until Claude picks it up. You can't take a queued message back. An **Interrupt** button by the input (and Esc on a desktop) stops the turn, as Esc does in the terminal; messages already queued then run, in the order you sent them. In an empty input, Up and Down step through the prompts you sent before, on any device.
- Subagents and background commands show on their own line in the conversation, with a spinner that turns green when they finish, how far they have got (tool uses, tokens, the tool in use) and a **Stop** of their own that ends just that one. They go on after Claude's turn ends, so an Agent that is Idle can still have some running, and **Interrupt** stops the turn but leaves them running.
- When Claude needs an answer, a panel takes over the input, so you answer with one tap. A permission ask shows the tool, what it acts on and, for an edit, the coloured diff, with numbered choices: **1. Yes**, **2. Yes, don't ask again** (only where Claude Code offers it; it saves the rule Claude Code itself suggests) and **No, and tell Claude what to do differently**, which opens a box for your reply. Each answer leaves a `⎿ permission: …` line in the conversation. A question or a plan to approve takes the input over the same way.
- Each Claude Agent's row in the sidebar shows whether it is **Idle**, **Working** or **Waiting for you**, and pulses blue (a Bell, unlike the orange of Waiting for you) when a turn ended, or Claude asked, while no page of yours was showing it. A background browser tab doesn't count as showing it, so if you walk away from your desk, the pulse waits for your phone. Opening the Agent on any device clears it on all of them.
- If something looks wrong, the raw JSON of any message is one gesture away: long-press it on a phone, or press `</>` beside it on desktop. The **Raw** switch above the conversation turns the whole Transcript into JSON and back.
- You can show Claude a screenshot or photo: paste it into the input or drop it on it on a desktop, or tap the picture button to choose from the photo library on a phone. A thumbnail shows before you send, and its ✕ takes it off. Claude takes PNG, JPEG, GIF and WebP up to about 3.9 MB (5 MB as base64, which is how Claude counts) and 8000 pixels on the longest side; one over that shows a message and is not attached. Sent images stay in the conversation, and are deleted with the Session.
- It keeps going when you close the browser, lock your phone or restart k-bench, and every device is an equal view of the same conversation.

The New Session dialog offers the same Launch options as for a Claude TUI: model, effort, advisor and Focus view, with the same meaning, remembered together with the kind. The advisor applies to that Session only and never changes your saved default. It runs your own installed `claude`, with the same `CLAUDE.md`, skills, plugins, hooks, MCP servers and permission rules you have in a terminal. Claude Code's commands are typed, as `/compact`, `/context`, `/usage`, `/model <name>`, `/effort <level>` and `/rename`, and their replies show in the conversation, without panels.

## Open in terminal: for everything else

Anything the web interface can't do is one tap away. **Open in terminal**, in the Session's **...** menu and in the Pane's top bar, switches the same Session to a Claude TUI on the same conversation, with the same Launch options. **Open in web** switches it back, and the turns you took in the terminal appear in the Transcript between "In the terminal" and "Back in web" dividers. Every device follows the switch.

k-bench asks first when something would be cut off: when Claude is working, when it is waiting for you, and when background tasks or subagents are running. Going back to the web always asks, because k-bench can't tell whether the terminal's Claude is busy.

The terminal is also where these live, because the Claude Agent has no web version of them: the rewind and branch controls (`/rewind` restores code a Claude Agent edited), `!` shell commands (a shell Session in the same Workspace is one tap away), viewing `/permissions` rules, `/hooks`, `/memory`, `/diff`, `/add-dir`, `/cd`, `/plugin`, `/status` and the `/config` panel, and vim mode and keybindings. The [checklist](../claude-agent-parity.md) has each one.

Whenever a Claude Agent meets something k-bench can't show or answer, it says so in the conversation with an **Unsupported** row that offers Open in terminal, and adds the kind to a list beside the Claude Agent settings. The list shows where k-bench should grow.

## Subscription only

A Claude Agent runs on your Claude subscription login and refuses to run on anything else. When it starts, it checks which account `claude` would use. If that is an API key, another provider, or a login with no subscription, the Session is Stopped and says why, so k-bench never costs you API pricing.

k-bench never holds, asks for or passes on your credentials. Log in the way you always do, with `claude` in a terminal.

## Folder trust

Claude Code asks whether you trust a folder the first time it opens in it. **A Claude Agent never shows that dialog**, because the Agent SDK it runs on never does. This changes what a Claude Agent does in a folder Claude Code has never trusted:

- **Project permission allow rules are ignored.** The Agent can ask for things your terminal would let through.
- **Project `.mcp.json` servers connect without the approval prompt.** In the terminal you would be asked first.
- **Hooks run**, including a project's.

If Claude Code has a trust warning for the folder, the Claude Agent shows it in the conversation. k-bench doesn't check trust itself, because that would mean reading Claude Code's private files.

The first **Open in terminal** in a folder Claude Code has never opened shows the trust dialog in the terminal, as a Claude TUI does the first time. Answer it there, as you would anywhere, and "No, exit" is selected by default. A folder you have only ever used through a Claude Agent counts as never opened.

If you rely on project allow rules, check that a Claude Agent asks when you expect it to in that folder. Claude Code's documentation implies, but does not state, that trust you accepted in a terminal earlier also applies to the Agent.
