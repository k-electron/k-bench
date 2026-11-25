import {
  ChevronRightIcon,
  FolderIcon,
  HomeIcon,
  MonitorIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, type DirectoryListing } from "@/api";
import { crumbs, type Place, places } from "@/folders";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { Input } from "./ui/input";

/**
 * Classes for a dialog that holds the folder picker: wide on a desktop, a full-screen sheet
 * on a phone.
 */
export const FOLDER_DIALOG_CLASS =
  "max-h-[92dvh] overflow-y-auto md:max-w-3xl max-md:top-0 max-md:left-0 max-md:flex max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:translate-none max-md:flex-col max-md:rounded-none max-md:border-0 max-md:p-4";

/**
 * The listing of `path`, or of the picker's starting folder when `path` is undefined. Cleared
 * while a new one loads, so the list never shows one folder's subfolders under another's name.
 */
function useDirectoryListing(path: string | undefined) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setListing(undefined);
    setError(undefined);
    let live = true;
    api.listDirectories(path).then(
      (result) => live && setListing(result),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return { listing, error };
}

/**
 * Picks a folder on the Host: Places to jump to, breadcrumbs for the folder shown, a filter,
 * and that folder's subfolders. The folder shown is the one chosen, reported through
 * `onChange`. It opens where the server says (beside the newest Workspace, or Home).
 */
export function FolderPicker({
  workspaces,
  onChange,
}: {
  /** The live Workspaces: their folders make Places and mark the list. */
  workspaces: WorkspaceState[];
  onChange: (folder: string | undefined) => void;
}) {
  // Undefined until the owner moves: the server's starting folder.
  const [path, setPath] = useState<string>();
  const [filter, setFilter] = useState("");
  const { listing, error } = useDirectoryListing(path);
  const [root, setRoot] = useState<string>();
  const here = path ?? listing?.path;

  useEffect(() => {
    if (listing?.root) setRoot(listing.root);
  }, [listing]);

  // Reported only when the folder changes, not whenever the owner passes a new callback.
  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => {
    report.current(here);
  }, [here]);

  const go = (folder: string) => {
    setPath(folder);
    setFilter("");
  };

  if (error && !here) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!here || !root) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[10rem_1fr]">
      <Places places={places(workspaces, root)} root={root} here={here} onGo={go} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <Breadcrumbs path={here} root={root} onGo={go} />
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            aria-label="Filter folders"
            placeholder="Filter"
            className="h-8 pl-8 text-sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            // Enter here must not submit the dialog's form.
            onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
          />
        </div>
        <FolderList
          listing={listing}
          error={error}
          filter={filter}
          workspaces={workspaces}
          onGo={go}
        />
      </div>
    </div>
  );
}

const PLACE_ICONS: Record<Place["kind"], typeof FolderIcon> = {
  home: HomeIcon,
  workspaces: FolderIcon,
  computer: MonitorIcon,
};

/** Home, the folders that hold Workspaces, and Computer. A row of chips on a phone. */
function Places({
  places,
  root,
  here,
  onGo,
}: {
  places: Place[];
  root: string;
  here: string;
  onGo: (folder: string) => void;
}) {
  return (
    <nav
      aria-label="Places"
      className="flex shrink-0 gap-1 overflow-x-auto md:flex-col md:overflow-visible md:border-r md:pr-2"
    >
      <p className="hidden px-2 text-[10px] uppercase tracking-wide text-muted-foreground md:block">
        Places
      </p>
      {places.map((place) => {
        const Icon = PLACE_ICONS[place.kind];
        return (
          <button
            key={place.path}
            type="button"
            title={tildePath(place.path, root)}
            aria-current={here === place.path ? "location" : undefined}
            onClick={() => onGo(place.path)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-left text-sm md:rounded-sm md:border-transparent md:px-2",
              here === place.path ? "bg-accent" : "hover:bg-accent",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{place.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function tildePath(path: string, root: string): string {
  if (path === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}

/** The folder shown, as crumbs from Home (or `/`); choosing one steps back up to it. */
function Breadcrumbs({
  path,
  root,
  onGo,
}: {
  path: string;
  root: string;
  onGo: (folder: string) => void;
}) {
  const all = crumbs(path, root);
  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex min-h-7 flex-wrap items-center gap-0.5 text-sm"
    >
      {all.map((crumb, index) => (
        <span key={crumb.path} className="flex items-center gap-0.5">
          {index > 0 && <ChevronRightIcon className="size-3 opacity-50" />}
          <button
            type="button"
            title={crumb.path}
            aria-current={index === all.length - 1 ? "location" : undefined}
            onClick={() => onGo(crumb.path)}
            className="rounded-sm px-1 hover:bg-accent aria-[current]:font-medium"
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** The shown folder's subfolders, narrowed by the filter; one with a Workspace says which. */
function FolderList({
  listing,
  error,
  filter,
  workspaces,
  onGo,
}: {
  listing: DirectoryListing | undefined;
  error: string | undefined;
  filter: string;
  workspaces: WorkspaceState[];
  onGo: (folder: string) => void;
}) {
  const id = useId();
  const workspaceIn = new Map(workspaces.map((w) => [w.folder, w.name]));
  const shown = (listing?.directories ?? []).filter((d) =>
    d.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <ul
      aria-label="Folders"
      className="min-h-40 flex-1 overflow-y-auto rounded-md border p-1 md:h-72 md:flex-none"
    >
      {error && (
        <li role="alert" className="p-1 text-sm text-destructive">
          {error}
        </li>
      )}
      {!listing && !error && (
        <li className="p-1 text-sm text-muted-foreground">Loading…</li>
      )}
      {shown.map((directory, index) => {
        const workspace = workspaceIn.get(directory.path);
        const markId = `${id}-${index}`;
        return (
          <li key={directory.path}>
            <button
              type="button"
              onClick={() => onGo(directory.path)}
              aria-describedby={workspace === undefined ? undefined : markId}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{directory.name}</span>
              {workspace !== undefined && (
                // Hidden from the button's name, which stays the folder's; it is the description.
                <span
                  id={markId}
                  aria-hidden
                  className="max-w-[40%] shrink-0 truncate rounded-sm bg-secondary px-1.5 text-xs text-muted-foreground"
                >
                  <span className="sr-only">Workspace </span>
                  {workspace}
                </span>
              )}
              <ChevronRightIcon className="size-3 shrink-0 opacity-50" />
            </button>
          </li>
        );
      })}
      {listing && shown.length === 0 && (
        <li className="p-1 text-sm text-muted-foreground">
          {filter.trim() ? "No folder matches" : "No subfolders"}
        </li>
      )}
    </ul>
  );
}
