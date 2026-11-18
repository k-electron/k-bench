# Live check spike (throwaway)

Scripts behind [Live check: run a real Agent SDK session against the unconfirmed parity rows](https://github.com/k-electron/k-bench/issues/121). Never merged. Results are in the resolution comment on that issue.

Run on 2026-11-17 with `@anthropic-ai/claude-agent-sdk` 0.3.327 against the installed `claude` 2.1.327, mostly on Haiku to keep turns cheap. Expected layout: `spike/` (these files plus `npm i @anthropic-ai/claude-agent-sdk`), `work/` (the session folder) and `out/` (JSONL logs of every SDK message) as siblings.

| Script                                                                                      | Checks                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `c134.mjs`                                                                                  | 1 plugins, 3 Focus view, 4 advisor routes and the off switch  |
| `c2678.mjs 2` / `6` / `7` / `8`                                                             | 2 plan approval, 6 `/clear`, 7 `@path`, 8 `/goal` and `/loop` |
| `c8b.mjs`                                                                                   | `/goal` over several continuations                            |
| `c5a.mjs` → terminal → `c5anchor.mjs` → terminal `/compact` → `c5anchor.mjs` → `c5back.mjs` | 5 Open in terminal and back                                   |

The terminal half of check 5 ran `claude --resume <id> --model haiku --permission-mode acceptEdits` in a private tmux server (`tmux -L livecheck`), driven with `send-keys` and read with `capture-pane` through `tw.sh`: one turn editing `story.txt`, then `/rewind` → the first web prompt → "Restore code", then `/exit`. A second resume took one more turn, ran `/compact` and exited.
