# Internals

How k-bench works inside. For setup, commands and the pull request flow, see [CONTRIBUTING](../../CONTRIBUTING.md). The vocabulary is in [GLOSSARY.md](../../GLOSSARY.md) and the design decisions are in [docs/adr/](../adr/).

- [Claude Agent internals](agent.md): the runtime, the wire protocol, the log and Agent folder, the relay and the browser side of a Claude Agent, and the interfaces later tickets build on.
- [Source layout](layout.md): what lives where in `scripts/`, `src/server/`, `web/` and `test/`.
- [The Bell](bell.md): the tmux-hook mechanism, why it works that way, and its known limitations.
- [The API](api.md): the HTTP and WebSocket endpoints.
- [Access](access.md): the login check and the Origin check, and [ADR 0003](../adr/0003-tailnet-only-single-user-access.md).
- [Packaging and the install](packaging.md): the npm package, the build, and how `k-bench install` turns it into the Installed instance.
- [Releasing](releasing.md): `pnpm release`, the release workflow, the changelog, and the owner's one-off npm setup.
- [Claude Agent parity checklist](../claude-agent-parity.md): every Claude TUI capability, and whether a Claude Agent does it, it goes through Open in terminal, or it is out of scope. Tick rows as tickets land.
- [Test seams](test-seams.md): the Seam 1, 2 and 3 harnesses, and how to write a test with them (see also [Testing](../testing.md)).
- [Install verification](install-verification.md): the manual checklist for the Installed instance, and how to remove it.
