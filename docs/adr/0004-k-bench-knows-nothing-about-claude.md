# k-bench knows nothing about Claude Code

k-bench exists to manage Claude Code work, but a Session is a plain persistent shell: k-bench doesn't launch, detect, or parse Claude conversations. This keeps the tool general and free of a dependency on Claude Code's CLI behaviour. Integration happens only through generic terminal features, such as the Bell (Claude Code can be configured to ring the terminal bell when it needs input). An optional per-Session start command may be added later without breaking this boundary.
