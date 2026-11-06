import { useState } from "react";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
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

/**
 * Launches a Claude Session in a Workspace. The name is optional (blank gives "session N");
 * the server's refusal, such as a taken name, shows here. Launch options will join the name
 * in this dialog.
 */
export function NewClaudeDialog({
  workspace,
  onLaunch,
  onClose,
}: {
  workspace: WorkspaceState;
  onLaunch: (input: { name: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [launching, setLaunching] = useState(false);

  const submit = async () => {
    setLaunching(true);
    try {
      await onLaunch({ name: name.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLaunching(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
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
              Runs Claude Code in the folder of {workspace.name}.
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
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={launching}>
              Launch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
