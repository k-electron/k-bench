# The API

The contract between the server and its clients. The rules the owner sees are in the [guide](../guide/README.md), and how a Claude Session launches and resumes is [ADR 0005](../adr/0005-k-bench-launches-claude-code.md).

## Conventions

- Every request and upgrade needs the login described in [Access](access.md). A request body must be `application/json` (415 otherwise).
- A refusal answers `{error}`, a message for the owner: 404 for an unknown Workspace or Session, 409 for a conflict, 422 for anything else invalid.
- Every successful request that is not a `GET` answers with a `State-Revision` header. The client that made the change waits for an events snapshot whose `revision` is at least that number, and then sees its change. Revisions start again from 0 when the server restarts.

## The state

`GET /api/state` answers 200 with the state. The events WebSocket sends the same shape with `revision` added. Both are defined in `src/shared/state-protocol.ts`.

- `openWorkspaceId`: the Open Workspace (the one last opened, else the first by position), or `null` when there are no Workspaces.
- `workspaces`, in the owner's order, each `{id, name, folder, position, createdAt, missing, sessions, rightPane}`. `createdAt` only orders by age. `missing` is true when the folder no longer exists.
- `sessions`: the Prime, the Worker, then the Other Sessions in the owner's order, each `{id, name, kind, role, status, bell}`. `kind` is `"shell"` or `"claude"`, `role` is `"prime"`, `"worker"` or `null` for an Other Session, and `status` is `"running"` or `"stopped"`.
- `rightPane`: `{shown, tabs}`, the Other Session ids opened in the right Pane as Tabs, in order, and the one shown, `null` for the Worker.

A Claude Session's Launch options and conversation ID are not in the state.

## Endpoints

- `GET /api/health`: 200 `{status: "ok"}`. What `k-bench status` asks.
- `GET /api/directories?path=&hidden=1`: 200 `{path, parent?, directories, root}`, the subfolders (`{name, path}`) of `path` for the folder picker, and `root`, the picker's Home. Without `path` it lists where the picker opens. Hidden folders only with `hidden=1`. 422 unless `path` is an existing absolute folder.
- `POST /api/workspaces` `{folder, name?, createMissingFolders?}`: 201 `{id, name, folder}`. Creates a Workspace with its Prime and Worker, neither started. With `createMissingFolders: true` a missing folder is made once every other check has passed. 409 for a taken name, or for a folder another Workspace has, with `{workspace: {id, name}}` naming it. 422 for a folder that doesn't exist or can't be made.
- `PATCH /api/workspaces/:id` `{name?, folder?, createMissingFolders?}`: 200 the Workspace. Renames it and/or changes its folder, making neither change if one is refused. 409 as for creating, 422 for a blank name or a folder that doesn't exist, 404.
- `PUT /api/workspaces/order` `{ids}`: 200 `{ids}`. 422 unless it lists every Workspace exactly once.
- `DELETE /api/workspaces/:id`: 204. Ends its Sessions and forgets it; the folder is never touched. 404.
- `POST /api/workspaces/:id/open` `{showWorker?}`: 200 `{id}`. Makes it the Open Workspace and, unless it is Missing, starts its Stopped Prime and Worker, answering once they have started. `showWorker: true` makes the right Pane show the Worker again, keeping its Tabs. 404.
- `PUT /api/workspaces/:id/right-pane` `{shown, tabs}`: 200 `{shown, tabs}`. Replaces the right Pane record. 422 unless every tab is an Other Session of the Workspace, at most once, and `shown` is `null` or one of the tabs. 404.
- `POST /api/workspaces/:id/sessions` `{name?, claude?}`: 201 `{id, name}`. Creates and starts a shell Session or, with `claude`, a Claude Session with those [Launch options](#launch-options). A blank name gives "session N". 409 for a taken name, "Prime" or "Worker". 422 for a Missing Workspace or a Launch option that isn't one of the choices, naming the field (`claude.model`). 404.
- `PUT /api/workspaces/:id/sessions/order` `{ids}`: 200 `{ids}`. 422 unless it lists every Other Session of the Workspace exactly once (never the Prime or Worker). 404.
- `PATCH /api/sessions/:id` `{name}`: 200 `{id, name}`. 409 for a taken name, "Prime" or "Worker", or a Prime or Worker; 422 for a blank name; 404.
- `DELETE /api/sessions/:id`: 204. Ends its program and forgets it and its Tab. 409 for a Prime or Worker, 404.
- `POST /api/sessions/:id/restart`: 200 `{id, name}`. Starts a Stopped Session again; a running one is left alone. 422 when its folder is gone, 404.
- `GET /api/claude/launch-options`: 200, the Launch options last used to create a Claude Session, all Default when there are none.

## Launch options

`{model, effort, advisor, focusView}`, defined in `src/shared/launch-options.ts`. A field left out is Default, which passes no flag, so the owner's own Claude Code settings apply. `src/server/claude.ts` maps each choice to Claude Code's flags.

- `model`: `default`, `fable`, `opus`, `sonnet` or `haiku`.
- `effort`: `default`, `low`, `medium`, `high`, `xhigh` or `max`.
- `advisor`: `default`, `off`, `fable`, `opus` or `sonnet`.
- `focusView`: a boolean, `false` by default.

k-bench doesn't check which model and advisor go together: Claude Code refuses a bad pairing when it starts. A Prime or Worker is always launched with k-bench's fixed options for its role, whatever is stored with it.

## WebSockets

- `GET /api/sessions/:id/terminal?cols=&rows=`: one Session's terminal, opened at the client's size. Output arrives as binary frames. The client sends JSON text frames: `{type: "input", data, automatic?}` and `{type: "resize", cols, rows}`. `automatic: true` marks input the terminal sent by itself (answers to tmux's queries), which never takes the window's size for its Device. Close code 4410 means the terminal has ended (the Session was deleted or is Stopped), so the client must not reconnect; 1011 means it couldn't be attached, and the client may try again. Defined in `src/shared/terminal-protocol.ts`.
- `GET /api/events`: the full state with its `revision`, as a JSON text frame, on connect and again whenever it changes, whether from a request on any Device or from tmux, such as a shell exiting. Clients send nothing.
