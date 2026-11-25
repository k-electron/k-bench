import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  MonitorIcon,
  SearchIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { api, type DirectoryListing } from "@/api";
import {
  crumbs,
  dirname,
  type FolderChoice,
  folderNameProblem,
  join,
  type Place,
  places,
} from "@/folders";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { Button } from "./ui/button";
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
 * With `climb`, a path that can't be listed gives way to its nearest ancestor that can.
 */
function useDirectoryListing(path: string | undefined, climb: boolean) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setListing(undefined);
    setError(undefined);
    let live = true;
    const load = (at: string | undefined): Promise<DirectoryListing> =>
      api.listDirectories(at).catch((e: unknown) => {
        if (climb && at !== undefined && at !== "/") return load(dirname(at));
        throw e;
      });
    load(path).then(
      (result) => live && setListing(result),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [path, climb]);
  return { listing, error };
}

/**
 * Picks a folder on the Host: Places to jump to, breadcrumbs for the folder shown, a filter,
 * that folder's subfolders, and New folder to name folders that don't exist yet (nothing is
 * made here; the dialog's request makes them). The choice is reported through `onChange`,
 * with whether the owner has moved since it opened. It opens at `start`, or the nearest
 * folder above it that exists, or else where the server says (beside the newest Workspace,
 * or Home).
 */
export function FolderPicker({
  workspaces,
  start,
  onChange,
}: {
  /** The live Workspaces: their folders make Places and mark the list. */
  workspaces: WorkspaceState[];
  start?: string;
  onChange: (choice: FolderChoice | undefined, picked: boolean) => void;
}) {
  // Undefined until the owner moves, without a `start`: the server's starting folder.
  const [base, setBase] = useState(start);
  // Still opening at `start`, which may not exist: list the nearest folder that does.
  const [opening, setOpening] = useState(start !== undefined);
  const [newFolders, setNewFolders] = useState<string[]>([]);
  const [picked, setPicked] = useState(false);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const { listing, error } = useDirectoryListing(base, opening);
  const [root, setRoot] = useState<string>();
  const here = base === undefined || opening ? listing?.path : base;

  useEffect(() => {
    if (listing?.root) setRoot(listing.root);
  }, [listing]);

  // Reported only when the choice changes, not whenever the owner passes a new callback.
  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => {
    report.current(here === undefined ? undefined : { base: here, newFolders }, picked);
  }, [here, newFolders, picked]);

  /** Moves the picker to `next`: the one way the choice changes. */
  const choose = (next: FolderChoice) => {
    if (next.base !== here || opening) {
      setBase(next.base);
      setOpening(false);
    }
    setNewFolders(next.newFolders);
    setPicked(true);
    setFilter("");
    setAdding(false);
  };
  const go = (folder: string) => choose({ base: folder, newFolders: [] });

  /** A new folder's name; one that already exists here just opens it. */
  const addFolder = (name: string) => {
    if (here === undefined) return;
    const existing =
      newFolders.length === 0
        ? listing?.directories.find((d) => d.name.toLowerCase() === name.toLowerCase())
        : undefined;
    if (existing) go(existing.path);
    else choose({ base: here, newFolders: [...newFolders, name] });
  };

  if (error && !here) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!here || !root) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const inNewFolder = newFolders.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[10rem_1fr]">
      <Places
        places={places(workspaces, root)}
        root={root}
        here={inNewFolder ? undefined : here}
        onGo={go}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <Breadcrumbs
          choice={{ base: here, newFolders }}
          root={root}
          onGo={go}
          onTrim={(count) =>
            choose({ base: here, newFolders: newFolders.slice(0, count) })
          }
        />
        <div className="flex gap-2">
          {!inNewFolder && (
            <div className="relative flex-1">
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
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => setAdding(true)}
          >
            <FolderPlusIcon />
            New folder
          </Button>
        </div>
        <FolderList
          listing={listing}
          error={error}
          filter={filter}
          workspaces={workspaces}
          newFolder={newFolders.at(-1)}
          adding={adding}
          onAdd={addFolder}
          onCancelAdd={() => setAdding(false)}
          onGo={go}
        />
        <PathLine choice={{ base: here, newFolders }} root={root} />
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
  /** The folder shown, when it exists. */
  here: string | undefined;
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

/**
 * The chosen folder, as crumbs from Home (or `/`) with new folders in italics. Choosing an
 * existing crumb steps back up to it; choosing a new one drops the new folders after it.
 */
function Breadcrumbs({
  choice,
  root,
  onGo,
  onTrim,
}: {
  choice: FolderChoice;
  root: string;
  onGo: (folder: string) => void;
  /** Keeps the first `count` new folders. */
  onTrim: (count: number) => void;
}) {
  const existing = crumbs(choice.base, root);
  const all = [
    ...existing.map((crumb) => ({ ...crumb, isNew: false, go: () => onGo(crumb.path) })),
    ...choice.newFolders.map((name, index) => ({
      label: name,
      path: join(choice.base, ...choice.newFolders.slice(0, index + 1)),
      isNew: true,
      go: () => onTrim(index + 1),
    })),
  ];
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
            title={crumb.isNew ? `${crumb.path} (doesn't exist yet)` : crumb.path}
            aria-current={index === all.length - 1 ? "location" : undefined}
            onClick={crumb.go}
            className={cn(
              "rounded-sm px-1 hover:bg-accent aria-[current]:font-medium",
              crumb.isNew && "italic",
            )}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** The folder the Workspace will get, with the folders that don't exist yet in italics. */
function PathLine({ choice, root }: { choice: FolderChoice; root: string }) {
  const count = choice.newFolders.length;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
      <span className="min-w-0 break-all font-mono">
        {tildePath(choice.base, root)}
        {choice.newFolders.map((name, index) => (
          <Fragment key={join(choice.base, ...choice.newFolders.slice(0, index + 1))}>
            {choice.base === "/" && index === 0 ? "" : "/"}
            <em className="text-foreground">{name}</em>
          </Fragment>
        ))}
      </span>
      {count > 0 && <span>{count === 1 ? "1 new folder" : `${count} new folders`}</span>}
    </p>
  );
}

/**
 * The shown folder's subfolders, narrowed by the filter; one with a Workspace says which.
 * Inside a new folder there is nothing to list: it says the folder doesn't exist yet.
 */
function FolderList({
  listing,
  error,
  filter,
  workspaces,
  newFolder,
  adding,
  onAdd,
  onCancelAdd,
  onGo,
}: {
  listing: DirectoryListing | undefined;
  error: string | undefined;
  filter: string;
  workspaces: WorkspaceState[];
  /** The new folder shown, when the folder shown doesn't exist yet. */
  newFolder: string | undefined;
  adding: boolean;
  onAdd: (name: string) => void;
  onCancelAdd: () => void;
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
      {adding && (
        <li>
          <NewFolderInput onAdd={onAdd} onCancel={onCancelAdd} />
        </li>
      )}
      {newFolder !== undefined ? (
        <li className="grid place-items-center gap-1 p-6 text-center text-sm text-muted-foreground">
          <FolderPlusIcon className="size-6" />
          <span>
            <em className="text-foreground">{newFolder}</em> doesn't exist yet. It'll be
            made along with the Workspace.
          </span>
          <span className="text-xs">Add another New folder to go deeper.</span>
        </li>
      ) : (
        <>
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
          {listing && shown.length === 0 && !adding && (
            <li className="p-1 text-sm text-muted-foreground">
              {filter.trim() ? "No folder matches" : "No subfolders"}
            </li>
          )}
        </>
      )}
    </ul>
  );
}

/** An inline name box for a new folder. Enter adds it; Escape, or leaving it empty, cancels. */
function NewFolderInput({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const problemId = useId();
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  // The dialog closes on Escape in a capturing listener on the document, so Escape here has
  // to be caught before that, on the window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.target !== input.current) return;
      event.stopPropagation();
      cancel.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="grid gap-1 px-1 py-1">
      <div className="flex items-center gap-2 px-1">
        <FolderPlusIcon className="size-4 shrink-0" />
        <Input
          ref={input}
          autoFocus
          aria-label="New folder name"
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : problemId}
          placeholder="New folder name"
          className="h-7 text-sm"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Enter here must not submit the dialog's form.
            event.preventDefault();
            const trimmed = name.trim();
            const why = folderNameProblem(trimmed);
            if (why) setProblem(why);
            else onAdd(trimmed);
          }}
          onBlur={() => name.trim() === "" && onCancel()}
        />
      </div>
      {problem && (
        <p id={problemId} className="px-7 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
