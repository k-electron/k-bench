import { useEffect, useRef } from "react";

/** One row of a picker: what it is called, what it takes, and a line about it. */
export interface PickerOption {
  /** Stable across renders. */
  key: string;
  /** What is picked, as shown (`/compact`, `src/app.ts`). */
  label: string;
  /** What follows it, dimmed (`<file>`). */
  hint?: string;
  /** A line about it, dimmed; cut at the edge. */
  detail?: string;
}

/** The DOM id of a row, for the input's `aria-activedescendant`. */
export function pickerOptionId(menuId: string, key: string): string {
  return `${menuId}-${key}`;
}

/**
 * A popup list over the input that the owner picks from while the focus stays in the input:
 * the `/` menu (#150) and the `@` file picker (#160). It only draws what it is given and says
 * what was picked; which rows there are, which is active and which keys move it are the
 * caller's (`useCommandMenu` and `useFileMenu`, with `handlePickerKey`). The rows are a `listbox` named `label`, and the
 * active one `aria-selected`.
 *
 * Pressing a row must not take the focus from the input (the keyboard on a phone would go),
 * so a press is cancelled and the pick is made by the click that follows.
 */
export function PickerMenu({
  id,
  label,
  options,
  active,
  onPick,
}: {
  id: string;
  label: string;
  options: readonly PickerOption[];
  /** Index of the active row. */
  active: number;
  onPick: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Keeps the active row in view as the arrow keys move it.
  useEffect(() => {
    const row = list.current?.children[active];
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div
      id={id}
      ref={list}
      role="listbox"
      aria-label={label}
      className="absolute inset-x-2 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
    >
      {options.map((option, index) => (
        // The input owns the keyboard (`aria-activedescendant`), so the row has no key handlers.
        // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are the input's, by design
        <div
          key={option.key}
          id={pickerOptionId(id, option.key)}
          role="option"
          tabIndex={-1}
          aria-selected={index === active}
          className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm ${
            index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(index)}
        >
          <span className="shrink-0 font-mono">{option.label}</span>
          {option.hint && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {option.hint}
            </span>
          )}
          {option.detail && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {option.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
