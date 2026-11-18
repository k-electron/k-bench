import { useEffect, useId, useState } from "react";
import {
  DEFAULT_LAUNCH_OPTIONS,
  LAUNCH_CHOICES,
  type LaunchOptions,
} from "../../../src/shared/launch-options.ts";
import type {
  ClaudeInterface,
  NewSessionKind,
  WorkspaceState,
} from "../../../src/shared/state-protocol.ts";
import { ApiError, api, type CreateSessionInput } from "../api";
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

/**
 * The kinds of Session the dialog offers, in the order shown. Adding a kind is one entry
 * here (and its handling on the server): `launchOptions` says whether it takes Launch options,
 * and `interface` is sent for a Claude Session that is not a Claude TUI. Claude Agent takes no
 * Launch options until ticket #143.
 */
const KINDS: {
  kind: NewSessionKind;
  label: string;
  launchOptions: boolean;
  interface?: ClaudeInterface;
}[] = [
  { kind: "shell", label: "Shell", launchOptions: false },
  { kind: "claude", label: "Claude TUI", launchOptions: true },
  {
    kind: "claude-agent",
    label: "Claude Agent (WIP)",
    launchOptions: false,
    interface: "agent",
  },
];

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

/** What the dialog opens on, which the Host keeps. */
interface Start {
  kind: NewSessionKind;
  claude: LaunchOptions;
}

/**
 * Creates a Session in a Workspace: the one dialog for every kind. The name is optional
 * (blank gives "session N") and is never remembered; the kind and the Launch options open as
 * last used, which the Host keeps. Until they arrive the choices are disabled (the name can
 * already be typed), so defaults never show and then jump. Enter creates. The server's
 * refusal shows here and keeps the other choices; a taken name shows beneath the name field,
 * any other refusal above Create. The dialog doesn't check which model and advisor go
 * together: Claude Code does, at launch.
 */
export function NewSessionDialog({
  workspace,
  onCreate,
  onClose,
}: {
  workspace: WorkspaceState;
  onCreate: (input: CreateSessionInput & { name: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>();
  const [error, setError] = useState<{ message: string; nameTaken: boolean }>();
  const [creating, setCreating] = useState(false);
  const idPrefix = useId();
  const focusViewId = `${idPrefix}-focusView`;
  const nameErrorId = `${idPrefix}-nameError`;

  useEffect(() => {
    let current = true;
    api
      .lastNewSession()
      // Without the Host's answer, offer a shell with everything Default rather than nothing.
      .catch((): Start => ({ kind: "shell", claude: DEFAULT_LAUNCH_OPTIONS }))
      .then((last) => current && setStart(last));
    return () => {
      current = false;
    };
  }, []);

  // A kind this build doesn't offer (the Host remembered it from a newer one) opens as Shell.
  const kind = KINDS.find((k) => k.kind === start?.kind) ?? KINDS[0];
  const options = start?.claude;

  const submit = async () => {
    if (!start || !options) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        claude: kind?.launchOptions ? options : undefined,
        interface: kind?.interface,
      });
      onClose();
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : String(e),
        nameTaken: e instanceof ApiError && e.status === 409,
      });
      setCreating(false);
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
            <DialogTitle>New Session</DialogTitle>
            <DialogDescription>
              {kind?.launchOptions
                ? `Runs Claude Code in the folder of ${workspace.name}. Default leaves a setting to your own Claude Code configuration.`
                : kind?.interface === "agent"
                  ? `Runs Claude Code in the folder of ${workspace.name} as a conversation you can follow from any device, not a terminal. Work in progress.`
                  : `Starts your shell in the folder of ${workspace.name}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Input
              aria-label="Session name"
              aria-invalid={error?.nameTaken || undefined}
              aria-describedby={error?.nameTaken ? nameErrorId : undefined}
              placeholder="Name (optional)"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(undefined);
              }}
              autoFocus
            />
            {error?.nameTaken && (
              <p id={nameErrorId} role="alert" className="text-sm text-destructive">
                {error.message}
              </p>
            )}
          </div>
          <fieldset
            disabled={!start}
            aria-busy={!start}
            className={`grid min-w-0 gap-4 ${start ? "" : "invisible"}`}
          >
            <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <label
                  key={k.kind}
                  className="flex h-9 flex-1 cursor-pointer whitespace-nowrap items-center gap-2 rounded-md border border-input px-3 text-sm font-medium has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-kind`}
                    className="size-4 accent-primary"
                    checked={k.kind === kind?.kind}
                    onChange={() => start && setStart({ ...start, kind: k.kind })}
                  />
                  {k.label}
                </label>
              ))}
            </div>
            {kind?.launchOptions && (
              <>
                {FIELDS.map(({ field, label }) => (
                  <div key={field} className="grid gap-1.5">
                    <label
                      htmlFor={`${idPrefix}-${field}`}
                      className="text-sm font-medium"
                    >
                      {label}
                    </label>
                    <Select
                      id={`${idPrefix}-${field}`}
                      value={options?.[field] ?? "default"}
                      onChange={(event) =>
                        start &&
                        options &&
                        setStart({
                          ...start,
                          claude: { ...options, [field]: event.target.value },
                        })
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
                      start &&
                      options &&
                      setStart({
                        ...start,
                        claude: { ...options, focusView: event.target.checked },
                      })
                    }
                  />
                  <label htmlFor={focusViewId} className="text-sm font-medium">
                    Focus view
                  </label>
                </div>
              </>
            )}
          </fieldset>
          {error && !error.nameTaken && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={creating || !start}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
