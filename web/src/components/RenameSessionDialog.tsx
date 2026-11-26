import { useId, useState } from "react";
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

/** Asks for a new name for a Session; shows the server's refusal (for example a taken name). */
export function RenameSessionDialog({
  open,
  onOpenChange,
  currentName,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string>();
  const nameId = useId();

  const submit = async () => {
    try {
      await onRename(name.trim());
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(currentName);
          setError(undefined);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
            <DialogDescription>
              Names are unique within their Workspace.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={nameId}>Session name</FieldLabel>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
              autoFocus
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="submit" disabled={name.trim() === ""}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
