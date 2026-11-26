# The terminal stays on xterm.js, drawn with its DOM renderer

The browser terminal is xterm.js with its default DOM renderer, plus its grapheme addon so that it agrees with tmux on how wide emoji are. tmux does the real terminal emulation (ADR-0001): the browser only shows tmux's screen. So a more faithful emulator in the browser buys little. What matters is that the browser draws what tmux sent, in the same cells tmux put it in. Number 0009 skips 0007 and 0008, which belonged to the abandoned Claude Agent work and are still linked from its merged pull requests.

## Considered Options

- **wterm with its libghostty core.** It draws emoji and block characters correctly, and it types through a real input field at the cursor. After one fix in k-bench's touch scrolling, a prototype showed no difference from xterm.js in typing or scrolling on the owner's iPhone. wterm was weeks old at version 0.6, and it replaces the text under the finger as the screen changes, which had cut drags short. [PR #197](https://github.com/k-electron/k-bench/pull/197) holds the prototype's measurements.
- **xterm.js's WebGL renderer.** It draws block characters solid and gains one column on a phone. But it takes the screen's text out of the page, which the browser tests read. It also needs a fallback for when iOS takes the graphics context away. JetBrains Mono's own block characters already draw Claude Code's mascot almost solid without it.

## Consequences

- The grapheme addon is marked experimental by xterm.js. Without it, xterm.js and tmux disagree on the width of some emoji (🙂, 👨‍👩‍👧). After one of those, the two put the cursor in different places and redraws go wrong.
