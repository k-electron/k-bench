# The API

The API so far. Every request needs the login described in [Access](access.md).

- `GET /api/health`: `{ "status": "ok" }`. What `k-bench status` asks; guarded like every other route (it needs the owner's login).
- `GET /api/state`: Workspaces with their Sessions (`running` or `stopped`, and `bell`).
- `POST /api/sessions/:id/restart`: starts a fresh shell for a Stopped Session in its Workspace folder, same id and name (a running Session is left alone; 422 when the folder is gone).
- `GET /api/directories?path=`: the subfolders of `path` (default: the configured picker root) for the folder picker; 422 if the path is not an existing absolute folder.
- `POST /api/workspaces` `{folder, name?}`: the name defaults to the folder name, with a "(2)"-style suffix when taken; an explicit name that is taken gets 409, a missing folder 422. And `POST /api/workspaces/:id/sessions` `{name?}`.
- `PATCH /api/workspaces/:id` `{name?, folder?}`: rename and/or change the folder; 409 for a taken name, 422 for a blank name or a folder that does not exist (neither change is made if one is refused), 404 for an unknown Workspace.
- `PUT /api/workspaces/order` `{ids}`: the full ordered list of Workspace ids (422 unless it is every Workspace exactly once).
- `DELETE /api/workspaces/:id`: ends every Session's shell, then removes the Workspace (204). The folder on disk is never touched.
- `PATCH /api/sessions/:id` `{name}` renames a Session (409 if the name is taken in its Workspace, 422 if empty); `DELETE /api/sessions/:id` ends its shell and removes it (204). Session names are unique per Workspace; created without a name, a Session gets "session N" with the next free N.
- `GET /api/sessions/:id/terminal?cols=&rows=` (WebSocket): output arrives as binary frames; input and resizes go out as JSON text frames, and close code 4410 means the terminal has ended (the Session was deleted, or is Stopped), so the client must not reconnect. The protocol is defined once, in `src/shared/terminal-protocol.ts`, which the server, the browser and the tests all import. Input the terminal sends by itself (answers to tmux's queries) is marked `automatic`, so it never takes the window's size for its device.
- `GET /api/events` (WebSocket): sends the full state (same shape as `GET /api/state`) as a JSON text frame on connect and again whenever it changes, whether from a request on any device or from something tmux-side such as a shell exiting. Clients send nothing.
