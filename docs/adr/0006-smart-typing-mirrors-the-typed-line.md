# Smart typing mirrors the typed line in the terminal's hidden field

On an iPhone the on-screen keyboard's typing aids (autocorrect, suggestions, double-space for a period, hold to delete) only work on text it can see in the focused field. xterm.js types through a hidden field that it keeps empty and marks as not for correction, so none of them work. With Smart typing on, k-bench leaves the text the owner has typed in that hidden field. Whenever the keyboard changes it, k-bench sends the Session the difference as Backspaces followed by new text. The Session's program still gets only ordinary keystrokes, so its own completion keeps working: shell Tab completion, Claude Code's `/` menu. No extra space on screen is used.

The field is cleared after every key that isn't text: Enter, Tab, Esc, arrows, Ctrl and the Extra keys. It starts each time with invisible filler before the caret, because iOS never repeats a held Backspace in an empty field. Deleting the filler sends Backspaces, so holding ⌫ keeps deleting text the program put there itself.

## Considered Options

- **A visible compose box above the keyboard.** It is the most reliable way to get the keyboard's features. But it costs vertical space on a phone, and it breaks programs that react to each keystroke, such as Claude Code's `/` menu and shell completion.
- **Rebuilding the field from the screen** (the text left of the terminal cursor) after every bit of output. This gives the keyboard real context, including text the program completed. But it rewrites the field while the owner types over a slow connection. WebKit also doesn't refresh the keyboard's idea of the text when a page changes it, except when the page empties it.

## Consequences

- The keyboard may produce characters a terminal mustn't get: curly quotes, long dashes, and the non-breaking space that WebKit puts at the end of a field. k-bench turns them back into plain ASCII before sending.
- iOS sends Enter before it applies a pending autocorrection. So Enter goes to the Session when the field reports the line break, after the correction has been sent.
- Spacebar-drag caret moves aren't followed. Programs differ in how they move the cursor, and in a hidden field iOS puts the caret in odd places. k-bench moves the caret back to the end instead. An edit away from the end is still sent correctly, by deleting back to it and retyping.
- k-bench can't tell when a full-screen program such as vim is running, because xterm.js only ever talks to tmux. Smart typing is therefore a per-Session switch in the Extra keys, and off behaves exactly as before.
- The evidence is a device probe kept on the `prototype/smart-typing-probe` branch.
