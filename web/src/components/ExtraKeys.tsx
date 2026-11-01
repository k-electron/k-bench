import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { sendKey, toggleCtrl, useCtrlArmed } from "../terminalInput";
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
      className="h-10 min-w-0 flex-1 px-2"
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
      <Key name="Esc" data={"\x1b"}>
        Esc
      </Key>
      <Key name="Tab" data={"\t"}>
        Tab
      </Key>
      <Key name="Shift Tab" data={"\x1b[Z"}>
        ⇧Tab
      </Key>
      <Button
        variant={ctrl ? "default" : "secondary"}
        aria-pressed={ctrl}
        className="h-10 min-w-0 flex-1 px-2"
        onMouseDown={keepFocus}
        onClick={toggleCtrl}
      >
        Ctrl
      </Button>
      <Key name="Left" data={"\x1b[D"}>
        <ArrowLeftIcon />
      </Key>
      <Key name="Up" data={"\x1b[A"}>
        <ArrowUpIcon />
      </Key>
      <Key name="Down" data={"\x1b[B"}>
        <ArrowDownIcon />
      </Key>
      <Key name="Right" data={"\x1b[C"}>
        <ArrowRightIcon />
      </Key>
    </div>
  );
}
