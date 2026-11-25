# k-bench is Workspace-centric

k-bench used to be a set of tools that happened to be grouped by Workspace. Either Pane could show any Session from any Workspace, and several Workspaces could point at one folder. In practice, mixing Workspaces in one view was never useful, and it muddied the context of each project. k-bench is now built around one Workspace at a time:

- The main view shows one **Open Workspace**, and no Pane shows a Session from another Workspace. The Open Workspace follows the owner between devices.
- Every Workspace has a **Prime** and a **Worker**: fixed Claude Sessions with Launch options set by k-bench. They sit in fixed Panes, the Prime on the left and the Worker on the right by default. Other Sessions open in the right Pane.
- A folder has at most one Workspace. A folder is the project, so a second Workspace on it would split that project's context, and would also mean a second Prime and Worker editing the same files.

## Considered Options

- **Keeping free Pane placement with a "Workspace filter" on top.** Rejected, because it keeps the muddied view one click away and still needs every Workspace-specific feature to handle mixed Panes.

## Consequences

- Requests to show two Workspaces side by side, or to put two Workspaces on one folder, are refused by design.
- The Focused Pane concept goes away.
- The upgrade gives every existing Workspace a Prime and a Worker, and throws away saved Pane layouts.
