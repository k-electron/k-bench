import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  SpellCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  setSmartTyping,
  useSmartTypingChoice,
  useSmartTypingOffered,
} from "../smartTyping";
import { KEYS, sendKey, toggleCtrl, useCtrlArmed } from "../terminalInput";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Toggle } from "./ui/toggle";

// Pressing a key must not take focus from the terminal, or the on-screen keyboard closes.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

const KEY = "h-10 min-w-0 px-0";
// Ctrl and Smart typing fill with the accent while on.
const TOGGLE = cn(
  KEY,
  "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
);

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
      variant="outline"
      aria-label={name}
      className={KEY}
      onMouseDown={keepFocus}
      onClick={() => sendKey(data)}
    >
      {children}
    </Button>
  );
}

/**
 * The keys a terminal needs and a phone keyboard lacks. Ctrl is one-shot: it applies to the
 * next key, whether tapped here or typed on the on-screen keyboard. Where Smart typing is
 * offered (an iPhone) the row ends with its switch for the Session shown.
 */
export function ExtraKeys({ sessionId }: { sessionId: string }) {
  const ctrl = useCtrlArmed();
  const smartTypingOffered = useSmartTypingOffered();
  const smartTyping = useSmartTypingChoice(sessionId);

  return (
    <ButtonGroup
      aria-label="Extra keys"
      // Equal columns: in a flex row the icon keys' padding made them wider than the others.
      className="grid w-full shrink-0 auto-cols-fr grid-flow-col border-t bg-sidebar p-1"
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
      <Toggle
        variant="outline"
        pressed={ctrl}
        className={TOGGLE}
        onMouseDown={keepFocus}
        onPressedChange={toggleCtrl}
      >
        Ctrl
      </Toggle>
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
      {smartTypingOffered && (
        <Toggle
          variant="outline"
          aria-label="Smart typing"
          pressed={smartTyping}
          className={TOGGLE}
          onMouseDown={keepFocus}
          onPressedChange={(on) => setSmartTyping(sessionId, on)}
        >
          <SpellCheckIcon />
        </Toggle>
      )}
    </ButtonGroup>
  );
}
