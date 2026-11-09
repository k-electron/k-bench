# How safely can a pinned Agent SDK drive an auto-updating `claude`?

Research for issue #105 on map #102. Checked 2026-11-08 against `@anthropic-ai/claude-agent-sdk` 0.3.319 and `claude` 2.1.319 (the two were level on this date). The SDK package was read as text and never executed. No mismatched pair was run, so failure behaviour below comes from documentation, SDK source and changelogs unless marked otherwise.

## Bottom line

Anthropic publishes no compatibility promise for a pinned SDK driving a different `claude`. The only pairing it describes is same-patch: SDK `0.3.N` bundles CLI `2.1.N`. The SDK does not compare versions at all, so nothing stops or warns about a mismatch.

In practice the protocol is evolved additively, and the reference describes per-feature behaviour on older CLIs, so drift usually degrades rather than crashes. The dangerous cases are the quiet ones: on an older CLI, some options are ignored without an error, and one of those is an SDK MCP tool permission policy. Version detection is good: `claude_code_version` is available before the first turn.

An already-running CLI keeps its version when an update lands, with one caveat found by observation (section 4).

## 1. How the versions are coupled

- **SDK `0.3.N` bundles CLI `2.1.N`.** The reference says "The SDK version tracks the bundled Claude Code version. SDK v0.3.191 bundles Claude Code v2.1.191", and a feature requiring a CLI version "needs the SDK release with the same patch number or later" ([TypeScript reference][ts]).
- **The bundled binary is chosen by exact-version optional dependencies.** `package.json` of 0.3.319 lists `@anthropic-ai/claude-agent-sdk-<platform>: "0.3.319"` for eight platforms and declares `"claudeCodeVersion": "2.1.319"`; `manifest.json` gives version 2.1.319 and per-platform checksums (SDK package). The SDK has spawned a native binary this way since 0.2.113 ([changelog][sdkcl]). `claudeCodeVersion` was added in 0.2.6 "for programmatically determining compatible CLI version" ([changelog][sdkcl]).
- **Each release is built to parity with one CLI release.** 279 changelog entries read "Updated to parity with Claude Code vX". Patch numbers differ only for eight 0.1.x releases and have matched since ([changelog][sdkcl]). One early release was reported as not shipping what its entry claimed: 0.1.30 claimed parity with 2.0.31 but contained 2.0.30 ([sdk#48][i48]).
- **Releases are effectively simultaneous and frequent.** Across 155 same-patch pairs on npm (patches 142 to 319), SDK publication trailed the CLI by a median of about 0 hours and at most 12.9 hours. From patch 280 to 319 there were 37 releases in 44 days ([npm registry][npm]). A pin therefore falls about six CLI releases behind per week.
- **Hosting guidance assumes the bundled binary.** "The bundled binary is pinned to the SDK package version, so updating the SDK is how you update the CLI. The SDK follows semver: take patch releases continuously and review the [...] changelog before taking a minor" ([hosting][hosting]). The move from 0.2.141 to 0.3.142 carried three entries marked **Breaking** ([changelog][sdkcl]).
- **With `pathToClaudeCodeExecutable` set, that path is spawned as given.** Bundled resolution runs only if the option is empty, and the string `claudeCodeVersion` does not occur in `sdk.mjs`, so the SDK has no check against its declared version (SDK package, `sdk.mjs`).

## 2. Compatibility promise or minimum version

**None found.** There is no compatibility statement, supported window or global minimum version for a different CLI in the [TypeScript reference][ts], [overview][overview], [hosting][hosting] or [SDK troubleshooting][sdkts] pages, the README, the changelog, or issue searches of the SDK repos.

What does exist:

- The option's documented purpose is narrow: "Only needed if optional dependencies were skipped during install or your platform isn't in the supported set" ([reference][ts]). The type comment says only "Path to the Claude Code executable" (`sdk.d.ts`).
- Minimums are stated per feature ("Requires Claude Code v2.1.205 or later"), and they are many ([reference][ts]). The reference acknowledges this setup directly: "A Claude Code executable older than v2.1.268, such as one you point `pathToClaudeCodeExecutable` at, ignores the option" ([reference][ts]).
- `cli_version_too_old` is a startup failure reason: "This Claude Code version is below the minimum Anthropic requires" ([reference][ts]). That floor is Anthropic's for the CLI itself and is unrelated to the SDK pin. Its value and how it is set are undocumented.
- Forward-compatibility guidance exists field by field: `capabilities` is "an open set: ignore values you don't recognize", and context usage evolves "additively" ([reference][ts]). This is guidance on specific types, not a protocol-wide guarantee.

## 3. How drift fails

For this product the usual direction is **CLI newer than the pin**, because the CLI auto-updates and k-bench does not. **CLI older than the SDK** happens if k-bench bumps its pin while the CLI lags: the `stable` channel is "typically about one week old", and Homebrew and package-manager installs do not auto-update by default ([setup][setup]).

### CLI newer than the SDK

| What changes                            | Failure                                                                                                                                                                                                                            | Source                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| New message types or fields             | Passed through. After handling known cases, the read loop enqueues every other message to the consumer. TypeScript types will not name them.                                                                                       | `sdk.mjs`                 |
| New CLI-to-SDK control requests         | The SDK answers with an error, `Unsupported control request subtype: <x>`. The effect on the CLI is per request and unknown.                                                                                                       | `sdk.mjs`                 |
| Wire names change                       | Has happened: the Agent tool name in `system:init` and `result` moved to `'Agent'` in a patch release and was reverted as "an unintentional breaking change".                                                                      | [Changelog 0.2.69][sdkcl] |
| Behaviour or defaults change            | The running CLI decides, regardless of the pin. Examples: fork subagents on by default and permission-mode start rules (0.3.302), PDF results in Read, `tool_use_result` caps. A consumer built against one shape can see another. | [Changelog][sdkcl]        |
| CLI removes a flag the SDK still passes | Would be a startup exit with `unknown option`. **No case found** affecting an SDK flag. 2.1.300 removing `--sandbox` from `claude remote-control` shows a removal can be a hard error.                                             | [CLI changelog][cccl]     |

### CLI older than the SDK

| What changes                       | Failure                                                                                                                                                                                                                                                                                                                                              | Source                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Option or field unknown to the CLI | **Silently ignored.** `McpServerToolPolicy`: "ignores the list. Then `always_ask` and `always_deny` aren't enforced". Also `addPlugins`, `holdOnCacheImpact`, `verbatimPrompts`, `cancel_queued`.                                                                                                                                                    | [Reference][ts], `sdk.d.ts` |
| Flag unknown to the CLI            | **Hard failure at start.** `pluginDelivery: 'initialize'` on a binary below 2.1.261 "exits at startup with an unknown-option error". The SDK always passes `--output-format stream-json --verbose --input-format stream-json`; others such as `--permission-prompt-tool=stdio` (when `canUseTool` is set) and `--setting-sources` depend on options. | `sdk.d.ts`, `sdk.mjs`       |
| Control request unknown to the CLI | Answers an error. Text in the 2.1.319 binary says "A CLI that predates the request answers the error" `Unsupported control request subtype: <x>`.                                                                                                                                                                                                    | CLI binary text             |
| Field the CLI refuses              | "An older CLI on a strict host refuses the whole answer" for an `AskUserQuestion` `unanswered` annotation.                                                                                                                                                                                                                                           | `sdk.d.ts`                  |
| Response fields missing            | `claude_code_version`, `capabilities` and `pending_permission_requests` are absent on older CLIs; `interrupt()` resolves to `undefined`.                                                                                                                                                                                                             | [Reference][ts], `sdk.d.ts` |

### Surface when the process dies

There is no error class. TypeScript rejects the message loop with a plain `Error`: `Claude Code process exited with code N. stderr: <tail>`, or `terminated by signal <name>`. `AbortError` is the only typed error ([SDK troubleshooting][sdkts], [reference][ts]). Stderr was added to the message in 0.3.211 ([changelog][sdkcl]). A past failure mode, `query()` hanging forever when the CLI failed to start, was reported in [sdk#255][i255] (closed).

Anthropic's own surfaces have had version-skew bugs: background-session attach failing with `EAUTH` after the daemon auto-updated (2.1.172), `claude daemon status` explaining "version-skew behavior" (2.1.176), and a context indicator resetting after an update (2.1.208) ([CLI changelog][cccl]).

## 4. An already-running CLI when the binary updates

- **Documented: it keeps running its version.** "Updates download and install in the background, then take effect the next time you start Claude Code" ([setup][setup]).
- **Updating does not overwrite in place on a native install.** The launcher is a symlink into `~/.local/share/claude/versions/`, and new versions are installed beside old ones ([setup][setup]).
- **Cleanup spares running versions, on one machine.** The installer keeps the launcher's version, "any version a session on the same machine is running", and the two newest, then deletes the rest ([setup][setup]).
- **The binary must stay readable.** "A running session reads parts of the Claude Code executable from disk as it works, not only at startup", and a truncated or (on network storage) deleted file crashes it, seen as `Bus error` or a Bun crash report ([setup][setup], [install troubleshooting][tsi]). On a local POSIX filesystem, unlinking an open file postpones removal of its contents ([POSIX `unlink`][posix]). An npm global upgrade deletes the previous binary in place, so that install path has less protection ([setup][setup]).
- **Observed on the owner's Host (2.1.318 to 2.1.319, native install):** an interactive process that started on 2.1.318 was still mapped to the 2.1.318 file four days later, after 2.1.319 had landed. Per-process lock files of the form `<version>#<pid>.lock` exist under `~/.local/state/claude/locks/`. This mechanism is undocumented.
- **Caveat, also observed:** two interactive `--resume` processes that started before 2.1.319 existed were mapped to 2.1.319 under the same PID, with a 2.1.319 lock acquired days later. That is consistent with an in-place relaunch. The trigger is unknown; the CLI changelog mentions an "auto-update relaunch" for `claude agents` (2.1.274). These were not SDK-driven processes.

Consequences that follow from the above:

- One long-lived `query()` maps to one subprocess ([hosting][hosting]), so a days-long Agent Runtime keeps one CLI version until that process ends, subject to the caveat above.
- Any respawn through the launcher path, including resume after a crash or a Host restart, gets whatever version is current. The pinned SDK is unchanged, so **drift appears at respawn, and the new version can differ from the one that wrote the transcript**.
- `system/init` is emitted per turn on headless stream-json runs (`sdk.d.ts`, `view_mode` comment), so a client can see a version change without polling if one occurs in-process.

## 5. Signals a client can read

| Signal                                                 | When                  | Requires                   | Notes                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initializationResult().claude_code_version`           | Before the first turn | SDK 0.3.296+, CLI 2.1.296+ | "the Claude Code version of the process that runs the session's turns". `undefined` on older CLIs.                                                                      |
| `SDKSystemMessage.claude_code_version` (`system/init`) | With each init        | Required field in the type | The same value.                                                                                                                                                         |
| `SDKSystemMessage.capabilities`                        | With each init        | CLI 2.1.205+               | Documented for feature detection "instead of comparing `claude_code_version` strings". Covers only named protocol behaviours, currently a handful.                      |
| `claudeCodeVersion` in the SDK's `package.json`        | Any time              | SDK 0.2.6+                 | The expected CLI version for the pin. Comparing it to the two above is left to the client.                                                                              |
| `claude --version`                                     | Any time              | None                       | What the next spawn gets. Compared with the running value, it signals that an update is installed.                                                                      |
| `startup_failure_reason`                               | Failed start          | SDK 0.3.274+               | Includes `cli_version_too_old`. Only some values are written by default; `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1` writes all, otherwise a stderr line and non-zero exit. |
| `Claude Code process exited with code N`               | Process death         | None                       | Match on message text; includes the stderr tail.                                                                                                                        |

The SDK also sets `CLAUDE_AGENT_SDK_VERSION` in the child's environment (`sdk.mjs`). That tells the CLI the SDK's version; no documented CLI behaviour depends on it.

## Options the facts leave open

Not decisions; ticket #110 and later work own those.

1. **What the Agent Runtime points at.** The launcher symlink follows updates at each spawn. The resolved `versions/<v>` path holds a version across respawns, but cleanup may delete it once no process holds it. The map has ruled out the bundled binary, though it remains the only pairing Anthropic documents as matched.
2. **What happens on a mismatch.** Compare `claude_code_version` with `claudeCodeVersion` at start and then show it, warn past a window, or refuse. No published window exists to borrow, so any number is k-bench's own.
3. **How to treat silently ignored options.** Gate any security-relevant option, such as a per-tool MCP policy, on a floor version or a capability, or avoid depending on those options.
4. **How fast the pin moves.** About six CLI releases a week. The range runs from following every patch to bumping on a schedule, with the parity checklist per bump.
5. **Whether to limit updates.** `autoUpdatesChannel: "stable"`, `minimumVersion` or `DISABLE_AUTOUPDATER` in user settings affect the owner's whole install. Setting `DISABLE_AUTOUPDATER` only in the SDK child's `env` is narrower, but see the first unconfirmed item below.
6. **Unknown messages and errors.** Pass-through in the read loop supports the map's drift guard as it stands. Process-death handling has to match on message text.

## Could not confirm

- Whether an SDK-driven CLI runs the background updater at all. The docs say it "checks for updates on startup and periodically while running" with no carve-out for `-p` or stream-json, and binary text did not settle it.
- Whether an SDK-driven CLI can relaunch itself in place, as the two interactive processes in section 4 appear to have done.
- Whether a transcript written by a newer CLI resumes cleanly on an older one, or the reverse. The [sessions page][sessions] does not address it.
- What the CLI does after the SDK answers an error to a control request it doesn't know, for each request type.
- Whether SDK control requests time out against an unresponsive CLI. No such timeout text was found in `sdk.mjs`, which is weak evidence.
- Real-world breakage from `pathToClaudeCodeExecutable` drift specifically. Searches of the SDK and Claude Code issue trackers found no report naming a version mismatch through this option. Absence of reports is not evidence of safety, since few integrations may run this way.
- A live test of any mismatched pair. A throwaway spike with an older CLI against the pinned SDK would settle several of the above.

## Sources

Primary, retrieved 2026-11-08:

- `@anthropic-ai/claude-agent-sdk` 0.3.319 npm tarball: `package.json`, `manifest.json`, `sdk.d.ts`, `sdk.mjs`, `README.md`
- `claude` 2.1.319 binary, embedded text only (minified, not a contract), and the local install layout
- [TypeScript SDK reference][ts], [overview][overview], [hosting][hosting], [sessions][sessions], [SDK troubleshooting][sdkts]
- [Advanced setup][setup], [install troubleshooting][tsi]
- [Agent SDK changelog][sdkcl], [Claude Code changelog][cccl], [sdk#48][i48], [sdk#255][i255], [npm registry][npm]
- [POSIX `unlink`][posix]

[ts]: https://code.claude.com/docs/en/agent-sdk/typescript
[overview]: https://code.claude.com/docs/en/agent-sdk/overview
[hosting]: https://code.claude.com/docs/en/agent-sdk/hosting
[sessions]: https://code.claude.com/docs/en/agent-sdk/sessions
[sdkts]: https://code.claude.com/docs/en/agent-sdk/troubleshooting
[setup]: https://code.claude.com/docs/en/setup
[tsi]: https://code.claude.com/docs/en/troubleshoot-install
[sdkcl]: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
[cccl]: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
[i48]: https://github.com/anthropics/claude-agent-sdk-typescript/issues/48
[i255]: https://github.com/anthropics/claude-agent-sdk-typescript/issues/255
[npm]: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
[posix]: https://pubs.opengroup.org/onlinepubs/9699919799/functions/unlink.html
