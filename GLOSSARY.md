# k-bench

A browser interface, reachable only on the owner's tailnet, to persistent terminals running on the owner's Mac, organised by project.

## Language

**Owner**:
The one person a k-bench install belongs to. It runs on their Host, and only their tailnet login can reach it.
_Avoid_: user, admin, account

**Host**:
The owner's Mac that runs k-bench and every Session.
_Avoid_: server, box, machine

**Workspace**:
A named entry pointing at a project folder on the Host. Several Workspaces may point at the same folder. A Workspace lasts until the owner deletes it, through Host reboots and whether or not it has any Sessions.
_Avoid_: project, repo, folder

**Missing**:
The state of a Workspace whose folder no longer exists on the Host. Its Sessions can't be started until the folder is fixed. Every other Workspace and Session keeps working.
_Avoid_: broken, invalid

**Session**:
A named, persistent program belonging to one Workspace, started in that Workspace's folder: the owner's shell, or Claude Code for a Claude Session. It keeps running whether or not any browser is viewing it.
_Avoid_: terminal, tab, tmux session

**Claude Session**:
A Session that runs one Claude conversation, started from the New Claude dialog with the owner's Launch options. Restarting it resumes that same Claude conversation.
_Avoid_: Claude terminal, agent session

**Launch options**:
The model, effort, advisor and Focus view a Claude Session starts with. They are fixed for the Claude Session's life.
_Avoid_: settings, config, flags

**Stopped**:
The state of a Session whose program no longer exists, because it exited, or the owner logged out of the Host or restarted it. A Stopped Session can be restarted in the same folder: a shell starts fresh, and a Claude Session resumes its Claude conversation.
_Avoid_: dead, closed, killed

**History**:
A Session's earlier output, beyond what fits on screen, that the owner can scroll back through.
_Avoid_: scrollback, buffer

**Bell**:
A Session's request for attention, raised when the Session's program rings the terminal bell and cleared once the owner views that Session.
_Avoid_: notification, alert, activity

**Claude conversation**:
A Claude Code conversation. A Claude Session runs exactly one and knows it by its conversation ID. One started by hand in an ordinary Session is invisible to k-bench.
_Avoid_: session, Claude session id (use conversation ID)

**Pane**:
One of at most two side-by-side slots in the main view, each showing one Session. On mobile there is a single Pane.
_Avoid_: split, window, tab

**Focused Pane**:
The Pane that opening a Session from the sidebar targets. Exactly one Pane is focused at a time.
_Avoid_: active pane, current pane

**Extra keys**:
On a phone, the keys a terminal needs that the on-screen keyboard lacks, such as Esc, Tab and Ctrl. They type into the Session in the Focused Pane. While the on-screen keyboard is up, only a few of them show, as a small overlay on the terminal.
_Avoid_: shortcut bar, toolbar, key row, typing keys

## Running k-bench

**Installed instance**:
The copy of k-bench the owner uses day to day, running in the background on the Host.
_Avoid_: prod, production

**Dev instance**:
A copy of k-bench run from the repo while developing it, fully separate from the Installed instance, so restarting it never touches the Sessions the owner is working in.
_Avoid_: local, staging
