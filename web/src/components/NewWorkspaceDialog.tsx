import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";

/** Creates a Workspace from a pasted folder path. */
export function NewWorkspaceDialog({
  onCreate,
}: {
  onCreate: (folder: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string>();

  const submit = async () => {
    try {
      await onCreate(folder.trim());
      setOpen(false);
      setFolder("");
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <PlusIcon />
          New Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
            <DialogDescription>
              Paste the path of a project folder on the Host.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Folder path"
            placeholder="/Users/you/projects/app"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={folder.trim() === ""}>
              Create Workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
