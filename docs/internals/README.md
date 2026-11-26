# Internals

Who owns what inside k-bench, and why. For setup, commands and the pull request flow, see [CONTRIBUTING](../../CONTRIBUTING.md). The vocabulary is in [GLOSSARY.md](../../GLOSSARY.md) and the design decisions are in [docs/adr/](../adr/).

- [Source layout](layout.md): what each module in `scripts/`, `src/`, `web/src/`, `test/` and `e2e/` owns.
- [The Bell](bell.md): the tmux-hook mechanism, why it works that way, and its known limitations.
- [The API](api.md): the HTTP and WebSocket endpoints, and the state they report.
- [Access](access.md): how the login check and the Origin check enforce [ADR 0003](../adr/0003-tailnet-only-single-user-access.md).
- [Packaging and the install](packaging.md): the npm package, the build, and how `k-bench install`, `uninstall` and `status` work.
- [Releasing](releasing.md): `pnpm release`, the release workflow, and the one-off npm setup kept for reference.
- [Test seams](test-seams.md): the Seam 1, 2 and 3 harnesses and the fake Claude Code (see also [Testing](../testing.md)).
- [Install verification](install-verification.md): the manual checklist for the Installed instance, and how to remove it.
