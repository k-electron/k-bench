import { ArrowUpIcon, FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type DirectoryListing } from "@/api";
import { Button } from "./ui/button";

/**
 * Browses the Host's folders, starting at `start` (the configured root when undefined).
 * Opening a folder reports it through `onSelect`, so the folder shown is the one chosen.
 */
export function FolderBrowser({
  start,
  onSelect,
}: {
  start?: string;
  onSelect: (folder: string) => void;
}) {
  const [target, setTarget] = useState(start);
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    api.listDirectories(target).then(
      (result) => {
        if (!current) return;
        setListing(result);
        setError(undefined);
      },
      (e) => {
        if (current) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      current = false;
    };
  }, [target]);

  const open = (folder: string) => {
    setTarget(folder);
    onSelect(folder);
  };

  return (
    <section aria-label="Folder browser" className="grid gap-1 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Parent folder"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && open(listing.parent)}
        >
          <ArrowUpIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {listing?.path}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="max-h-60 overflow-y-auto">
        {listing?.directories.map((directory) => (
          <li key={directory.path}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal"
              onClick={() => open(directory.path)}
            >
              <FolderIcon />
              {directory.name}
            </Button>
          </li>
        ))}
        {listing && listing.directories.length === 0 && (
          <li className="px-2 py-1 text-sm text-muted-foreground">No subfolders</li>
        )}
      </ul>
    </section>
  );
}
