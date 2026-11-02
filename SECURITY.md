# Security policy

## Reporting a vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** (or go to <https://github.com/k-electron/k-bench/security/advisories/new>).

Please do not report a vulnerability in a public issue, pull request or discussion, and do not post details of one anywhere public before it is fixed.

## Why this matters

k-bench is a remote shell: anyone who can reach it can run commands on the owner's Mac as the owner. Its only defence is that only the owner's own tailnet login gets in (see [Access](docs/internals/access.md) and [ADR 0003](docs/adr/0003-tailnet-only-single-user-access.md)). A bug that lets someone else past that check, such as the login check, the Origin check, or the server listening beyond `127.0.0.1`, is therefore serious, and so is anything that lets a web page on another site act on the owner's behalf. Please report these even if you are unsure they are exploitable.

## What to include

- What you found and which part of k-bench it affects.
- The steps to reproduce it, or a proof of concept.
- The version or commit you tested, and your macOS and Node versions.

Do not include a real hostname, tailnet name or login in your report beyond what is needed to reproduce.
