import {
  PERMISSION_MODE_LABEL,
  type PermissionMode,
} from "../../../../src/shared/agent-protocol.ts";

/**
 * The line under the input that says which permission mode Claude Code is in. Tapping it
 * switches to the next mode, as Shift+Tab does in the input on desktop (`Composer`). Every
 * device shows the same mode: it is whatever the runtime last said, never a local guess, so
 * a tap shows its effect only once the runtime has applied it.
 */
export function ModeLine({
  mode,
  onCycle,
  disabled,
}: {
  mode: PermissionMode;
  onCycle: () => void;
  /** Nothing can be changed: the Agent has ended, or the connection is down. */
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Permission mode"
      disabled={disabled}
      onClick={onCycle}
      className="flex min-h-9 w-full shrink-0 items-center gap-2 border-t px-3 text-left text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
    >
      <span aria-hidden="true">⏵⏵</span>
      <span>{PERMISSION_MODE_LABEL[mode]}</span>
      <span className="ml-auto hidden text-[0.7rem] opacity-70 md:inline">
        shift+tab to cycle
      </span>
    </button>
  );
}
