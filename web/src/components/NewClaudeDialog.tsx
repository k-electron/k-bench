import { useEffect, useId, useState } from "react";
import {
  DEFAULT_LAUNCH_OPTIONS,
  LAUNCH_CHOICES,
  type LaunchOptions,
} from "../../../src/shared/launch-options.ts";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { api } from "../api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

const FIELDS = [
  { field: "model", label: "Model" },
  { field: "effort", label: "Effort" },
  { field: "advisor", label: "Advisor" },
] as const;

/** "default" is "Default", "xhigh" is "XHigh", the rest are capitalised. */
function choiceLabel(choice: string): string {
  if (choice === "xhigh") return "XHigh";
  return choice.charAt(0).toUpperCase() + choice.slice(1);
}

/**
 * Launches a Claude Session in a Workspace. The name is optional (blank gives "session N") and
 * is never remembered; the Launch options open as last used, which the Host keeps. Until they
 * arrive the choices are hidden and Launch is off, so defaults never show and then jump, while
 * the name can already be typed. The server's refusal, such as a taken name, shows here and
 * keeps the other choices. The dialog doesn't check which model and advisor go together:
 * Claude Code does, at launch.
 */
export function NewClaudeDialog({
  workspace,
  onLaunch,
  onClose,
}: {
  workspace: WorkspaceState;
  onLaunch: (input: { name: string; claude: LaunchOptions }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [options, setOptions] = useState<LaunchOptions>();
  const [error, setError] = useState<string>();
  const [launching, setLaunching] = useState(false);
  const idPrefix = useId();
  const focusViewId = `${idPrefix}-focusView`;

  useEffect(() => {
    let current = true;
    api
      .lastLaunchOptions()
      // Without the Host's answer, launch with everything Default rather than not at all.
      .catch(() => DEFAULT_LAUNCH_OPTIONS)
      .then((last) => current && setOptions(last));
    return () => {
      current = false;
    };
  }, []);

  const submit = async () => {
    if (!options) return;
    setLaunching(true);
    try {
      await onLaunch({ name: name.trim(), claude: options });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLaunching(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Tall enough to scroll when a phone's keyboard takes the screen. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New Claude Session</DialogTitle>
            <DialogDescription>
              Runs Claude Code in the folder of {workspace.name}. Default leaves a setting
              to your own Claude Code configuration.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Session name"
            placeholder="Name (optional)"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
            autoFocus
          />
          <fieldset
            disabled={!options}
            aria-busy={!options}
            className={`grid min-w-0 gap-4 ${options ? "" : "invisible"}`}
          >
            {FIELDS.map(({ field, label }) => (
              <div key={field} className="grid gap-1.5">
                <label htmlFor={`${idPrefix}-${field}`} className="text-sm font-medium">
                  {label}
                </label>
                <Select
                  id={`${idPrefix}-${field}`}
                  value={options?.[field] ?? "default"}
                  onChange={(event) =>
                    options && setOptions({ ...options, [field]: event.target.value })
                  }
                >
                  {LAUNCH_CHOICES[field].map((choice) => (
                    <option key={choice} value={choice}>
                      {choiceLabel(choice)}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                id={focusViewId}
                type="checkbox"
                className="size-4 accent-primary"
                checked={options?.focusView ?? false}
                onChange={(event) =>
                  options && setOptions({ ...options, focusView: event.target.checked })
                }
              />
              <label htmlFor={focusViewId} className="text-sm font-medium">
                Focus view
              </label>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={launching || !options}>
              Launch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
