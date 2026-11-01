import { FolderSearchIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { FolderBrowser } from "./FolderBrowser";
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

/** Creates a Workspace from a pasted folder path or one picked by browsing the Host. */
export function NewWorkspaceDialog({
  onCreate,
}: {
  onCreate: (input: { folder: string; name?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    try {
      await onCreate({ folder: folder.trim(), name: name.trim() || undefined });
      setOpen(false);
      setFolder("");
      setName("");
      setBrowsing(false);
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
              Paste the path of a project folder on the Host, or browse for it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              aria-label="Folder path"
              placeholder="/Users/you/projects/app"
              value={folder}
              onChange={(event) => {
                setFolder(event.target.value);
                setError(undefined);
              }}
              autoFocus
            />
            <Button
              type="button"
              variant="secondary"
              aria-expanded={browsing}
              onClick={() => setBrowsing((b) => !b)}
            >
              <FolderSearchIcon />
              Browse folders
            </Button>
          </div>
          {browsing && (
            <FolderBrowser
              onSelect={(selected) => {
                setFolder(selected);
                setError(undefined);
              }}
            />
          )}
          <Input
            aria-label="Name"
            placeholder="Name (defaults to the folder name)"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
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
