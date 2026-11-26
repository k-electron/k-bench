import { useEffect, useId, useState } from "react";
import {
  DEFAULT_LAUNCH_OPTIONS,
  LAUNCH_CHOICES,
  type LaunchOptions,
} from "../../../src/shared/launch-options.ts";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { ApiError, api } from "../api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";

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
 * the name can already be typed. The server's refusal shows here and keeps the other choices;
 * a taken name shows beneath the name field, any other refusal above Launch. The dialog doesn't check which model and advisor go together:
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
  const [error, setError] = useState<{ message: string; nameTaken: boolean }>();
  const [launching, setLaunching] = useState(false);
  const idPrefix = useId();
  const nameId = `${idPrefix}-name`;
  const focusViewId = `${idPrefix}-focusView`;
  const nameErrorId = `${idPrefix}-nameError`;

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
      setError({
        message: e instanceof Error ? e.message : String(e),
        nameTaken: e instanceof ApiError && e.status === 409,
      });
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
          <Field data-invalid={error?.nameTaken || undefined}>
            <FieldLabel htmlFor={nameId}>Session name</FieldLabel>
            <Input
              id={nameId}
              aria-invalid={error?.nameTaken || undefined}
              aria-describedby={error?.nameTaken ? nameErrorId : undefined}
              placeholder="Optional"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(undefined);
              }}
              autoFocus
            />
            {error?.nameTaken && (
              <FieldError id={nameErrorId}>{error.message}</FieldError>
            )}
          </Field>
          <fieldset
            disabled={!options}
            aria-busy={!options}
            className={`grid min-w-0 gap-4 ${options ? "" : "invisible"}`}
          >
            {FIELDS.map(({ field, label }) => (
              <Field key={field}>
                <FieldLabel htmlFor={`${idPrefix}-${field}`}>{label}</FieldLabel>
                <Select
                  value={options?.[field] ?? "default"}
                  onValueChange={(value) =>
                    options && setOptions({ ...options, [field]: value })
                  }
                >
                  <SelectTrigger id={`${idPrefix}-${field}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LAUNCH_CHOICES[field].map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {choiceLabel(choice)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ))}
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
              <Label htmlFor={focusViewId}>Focus view</Label>
              <Switch
                id={focusViewId}
                checked={options?.focusView ?? false}
                onCheckedChange={(checked) =>
                  options && setOptions({ ...options, focusView: checked })
                }
              />
            </div>
          </fieldset>
          {error && !error.nameTaken && <FieldError>{error.message}</FieldError>}
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
