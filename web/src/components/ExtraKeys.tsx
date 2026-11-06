import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { KEYS, sendKey, toggleCtrl, useCtrlArmed } from "../terminalInput";
import { Button } from "./ui/button";

// Pressing a key must not take focus from the terminal, or the on-screen keyboard closes.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function Key({
  name,
  data,
  children,
}: {
  name: string;
  data: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant="secondary"
      aria-label={name}
      className="h-10 min-w-0 flex-1 px-0"
      onMouseDown={keepFocus}
      onClick={() => sendKey(data)}
    >
      {children}
    </Button>
  );
}

/**
 * The keys a terminal needs and a phone keyboard lacks. Ctrl is one-shot: it applies to the
 * next key, whether tapped here or typed on the on-screen keyboard.
 */
export function ExtraKeys() {
  const ctrl = useCtrlArmed();

  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the row
    <div
      role="group"
      aria-label="Extra keys"
      className="flex shrink-0 gap-1 border-t bg-card p-1"
    >
      <Key name="Esc" data={KEYS.esc}>
        ⎋
      </Key>
      <Key name="Tab" data={KEYS.tab}>
        ⇥
      </Key>
      <Key name="Shift Tab" data={KEYS.shiftTab}>
        ⇤
      </Key>
      <Button
        variant={ctrl ? "default" : "secondary"}
        aria-pressed={ctrl}
        className="h-10 min-w-0 flex-1 px-0"
        onMouseDown={keepFocus}
        onClick={toggleCtrl}
      >
        Ctrl
      </Button>
      <Key name="Left" data={KEYS.left}>
        <ArrowLeftIcon />
      </Key>
      <Key name="Up" data={KEYS.up}>
        <ArrowUpIcon />
      </Key>
      <Key name="Down" data={KEYS.down}>
        <ArrowDownIcon />
      </Key>
      <Key name="Right" data={KEYS.right}>
        <ArrowRightIcon />
      </Key>
      <Key name="Enter" data={KEYS.enter}>
        ⏎
      </Key>
    </div>
  );
}
