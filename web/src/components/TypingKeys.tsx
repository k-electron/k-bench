import type { ReactNode } from "react";
import { closeKeyboard, KEYS, sendKey } from "../terminalInput";

// Pressing a key must not take focus from the terminal, or the on-screen keyboard closes.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function Key({
  name,
  onPress,
  children,
}: {
  name: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      className="flex size-9 items-center justify-center rounded-md bg-secondary/60 text-sm text-secondary-foreground backdrop-blur-sm active:bg-primary active:text-primary-foreground"
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
 * corner with the few extra keys that fit, in place of the full Extra keys row. Ctrl and
 * ⇧Tab are only on the full row, with the keyboard down.
 */
export function TypingKeys() {
  const send = (data: string) => () => sendKey(data);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the keys
    <div
      role="group"
      aria-label="Typing keys"
      className="absolute top-1 right-1 z-10 grid grid-cols-4 gap-1"
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
      <Key name="Close keyboard" onPress={closeKeyboard}>
        ⌄
      </Key>
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
    </div>
  );
}
