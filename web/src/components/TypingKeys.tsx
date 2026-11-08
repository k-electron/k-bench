import type { ReactNode } from "react";
import {
  canReadClipboard,
  closeKeyboard,
  KEYS,
  pasteFromClipboard,
  sendKey,
} from "../terminalInput";

// Pressing a key must not take focus from the terminal, or the on-screen keyboard closes.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function Key({
  name,
  onPress,
  className = "",
  children,
}: {
  name: string;
  onPress: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      className={`pointer-events-auto flex size-9 items-center justify-center rounded-md bg-secondary/60 text-sm text-secondary-foreground backdrop-blur-sm active:bg-primary active:text-primary-foreground ${className}`}
      onMouseDown={keepFocus}
      // WebKit only applies :active when the element listens for touches.
      onTouchStart={() => {}}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/**
 * While the on-screen keyboard is up: a translucent overlay in the terminal's top-right
 * corner with the few extra keys that fit, in place of the full Extra keys row, and Paste
 * where the browser can read the clipboard. Ctrl and ⇧Tab are only on the full row, with the
 * keyboard down.
 */
export function TypingKeys() {
  const send = (data: string) => () => sendKey(data);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the keys
    <div
      role="group"
      aria-label="Typing keys"
      // Only the keys take touches: the gaps and the empty slots reach the terminal under them.
      className="pointer-events-none absolute top-1 right-1 z-10 grid grid-cols-4 gap-1"
    >
      <Key name="Esc" onPress={send(KEYS.esc)}>
        ⎋
      </Key>
      <Key name="Tab" onPress={send(KEYS.tab)}>
        ⇥
      </Key>
      <Key name="Enter" onPress={send(KEYS.enter)}>
        ⏎
      </Key>
      {canReadClipboard() ? (
        <Key name="Paste" onPress={pasteFromClipboard}>
          <span className="text-[11px]">Paste</span>
        </Key>
      ) : (
        <span aria-hidden="true" />
      )}
      <Key name="Left" onPress={send(KEYS.left)}>
        ←
      </Key>
      <Key name="Up" onPress={send(KEYS.up)}>
        ↑
      </Key>
      <Key name="Down" onPress={send(KEYS.down)}>
        ↓
      </Key>
      <Key name="Right" onPress={send(KEYS.right)}>
        →
      </Key>
      <Key name="Close keyboard" onPress={closeKeyboard} className="col-start-4">
        ⌄
      </Key>
    </div>
  );
}
