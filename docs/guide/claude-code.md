# Using k-bench with Claude Code

k-bench runs real Claude Code in a real terminal. It adds nothing to Claude Code and knows nothing about it: a Claude conversation is a program running in a Session, like any other. This page is about the few things worth setting up so the two work well together.

![Claude Code running in a Session, with a dev server Session in another Workspace](../images/hero.png)

## Run Claude Code in a Session

1. Create a [Workspace](using-k-bench.md#workspaces-and-sessions) for your project folder.
2. Create a Session in it and run `claude`.

Your shell, your PATH and your Claude Code configuration are exactly your own. A Session starts your own login shell on your Mac, in the Workspace's folder, so the programs on your PATH, your aliases, your `~/.claude` settings, your slash commands, skills and hooks, and the account you are signed in to are what they are in a terminal window on that Mac. Nothing about Claude Code is reconfigured, wrapped or hidden.

## Make Claude Code ring the Bell when it is waiting

k-bench raises a [Bell](using-k-bench.md#bells) when a Session's shell rings the terminal bell. Claude Code can ring the terminal bell when a task finishes or it is waiting for you on a permission prompt. Turn that on, and a Bell shows on that Session in the sidebar.

Add this to `~/.claude/settings.json` on the Host (merging it with any settings already in the file):

```json
{
  "preferredNotifChannel": "terminal_bell"
}
```

The setting is called `preferredNotifChannel`, and `"terminal_bell"` makes Claude Code ring the bell character in any terminal. You can also set it from inside Claude Code: run `/config` and change **Local notifications**. With the default (`"auto"`), Claude Code sends a desktop notification in a few terminals and does nothing in most others, so set it explicitly for k-bench.

Sources, from Claude Code's current documentation:

- [`preferredNotifChannel` in the settings reference](https://code.claude.com/docs/en/settings-reference#preferrednotifchannel), which lists its values and where it applies.
- [Get a terminal bell or notification](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification), which says when Claude Code sends the notification: when it finishes a task or pauses for a permission prompt, and you appear to be away from the terminal.

To check it, start a short task in a Session, then open a different Session. When Claude Code finishes, the first Session shows a Bell. Remember that a Session only raises a Bell while nothing is viewing it, so a tab left open on that Session elsewhere hides it. See [Troubleshooting](troubleshooting.md#a-session-never-shows-a-bell).

## One Session per Claude conversation

Give each Claude conversation its own Session, and rename the Session after the task (**...** then **Rename**). Then:

- you can run several conversations at once and switch between them from the sidebar;
- a Bell tells you which one is waiting, instead of you checking each in turn;
- a conversation carries on in its Session when you close the tab or lose your connection.

Several Sessions can share one Workspace, and several Workspaces can point at the same folder. If two conversations will edit the same project at once, they can step on each other's files. A common remedy is a separate git worktree for each, with a Workspace per worktree.

After you log out of your Mac or restart it, your Sessions are [Stopped](using-k-bench.md#stopped-sessions-logging-out-and-restarting) and the conversations in them have ended. Restart the Session, then bring the conversation back with Claude Code's own `/resume`.

## A second Pane for a dev server

On a wide screen, put Claude Code in one [Pane](using-k-bench.md#panes) and a dev server, a test watcher or a log tail in the other. Create a second Session in the same Workspace for it, open it with `⌘`-click (or **Open in other pane**), and use `⌘\` to move between the two. You see Claude's changes take effect as they happen.

## Driving Claude Code from your phone

On a phone, the [extra keys](using-k-bench.md#the-phone-layout) cover the keys Claude Code uses that a phone keyboard lacks. [Claude Code's keyboard shortcuts](https://code.claude.com/docs/en/interactive-mode) list them all. The ones you will reach for:

| Key                        | What it does in Claude Code                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Esc**                    | Interrupts Claude mid-response so you can redirect it, closes a dialog, and declines a permission prompt. Tap it twice, quickly, to clear your draft or, with an empty prompt, open the rewind menu. |
| **⇧Tab**                   | Cycles Claude Code's permission modes.                                                                                                                                                               |
| **Ctrl**, then `c`         | Interrupts a running operation (Ctrl is one-shot: tap it, then press `c`). With nothing running, the first press clears your prompt and a second one exits Claude Code, so don't repeat it by habit. |
| **Tab** and the arrow keys | Tab accepts an autocomplete suggestion. The arrow keys move through menus and your prompt history.                                                                                                   |

Next: [Troubleshooting](troubleshooting.md).
