import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  MonitorIcon,
  TextCursorInputIcon,
} from "lucide-react";
import { Fragment, type RefObject, useEffect, useId, useRef, useState } from "react";
import { api, type DirectoryListing } from "@/api";
import {
  basename,
  choicePath,
  crumbs,
  dirname,
  expandPath,
  type FolderChoice,
  folderNameProblem,
  join,
  type Place,
  places,
  tildePath,
  typedPath,
} from "@/folders";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "../../../src/shared/state-protocol.ts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { Button } from "./ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
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
 * With `climb`, a path that can't be listed gives way to its nearest ancestor that can. With
 * `hidden`, it includes hidden folders (names starting with `.`).
 */
function useDirectoryListing(
  path: string | undefined,
  { climb = false, hidden = false }: { climb?: boolean; hidden?: boolean } = {},
) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setListing(undefined);
    setError(undefined);
    let live = true;
    const load = (at: string | undefined): Promise<DirectoryListing> =>
      api.listDirectories(at, { hidden }).catch((e: unknown) => {
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
  }, [path, climb, hidden]);
  return { listing, error };
}

/**
 * The folder a typed path means, as a choice: its deepest folder that exists, and the rest as
 * new folders. Nothing is made.
 */
async function resolveTypedPath(path: string): Promise<FolderChoice> {
  const newFolders: string[] = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      return { base: (await api.listDirectories(at)).path, newFolders };
    } catch (e) {
      if (at === "/") throw e;
      newFolders.unshift(basename(at));
    }
  }
}

/**
 * Calls `onEscape` for Escape pressed in `input`. The dialog closes on Escape in a capturing
 * listener on the document, so it has to be caught before that, on the window.
 */
function useEscapeIn(input: RefObject<HTMLInputElement | null>, onEscape: () => void) {
  const callback = useRef(onEscape);
  callback.current = onEscape;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.target !== input.current) return;
      event.stopPropagation();
      callback.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [input]);
}

/**
 * Picks a folder on the Host: Places to jump to, breadcrumbs for the folder shown (which turn
 * into a path field to type or paste a path), that folder's subfolders with a filter, and New
 * folder to name folders that don't exist yet (nothing is made here; the dialog's request
 * makes them). Places and the subfolders are shadcn `Command`s. The choice is reported through `onChange`,
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
  const { listing, error } = useDirectoryListing(base, { climb: opening });
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
  // The innermost new folder, when the folder shown doesn't exist yet.
  const newFolder = newFolders.at(-1);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[10rem_1fr]">
      <Places
        places={places(workspaces, root)}
        root={root}
        here={newFolder === undefined ? here : undefined}
        onGo={go}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <PathBar choice={{ base: here, newFolders }} root={root} onChoose={choose} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <FolderPlusIcon />
            New folder
          </Button>
        </div>
        {/* Outside the list's Command, which would take its arrow, Home, End and Enter keys. */}
        {adding && <NewFolderInput onAdd={addFolder} onCancel={() => setAdding(false)} />}
        {newFolder !== undefined ? (
          <NewFolderNote name={newFolder} />
        ) : (
          <FolderList
            listing={listing}
            error={error}
            filter={filter}
            onFilter={setFilter}
            workspaces={workspaces}
            onGo={go}
          />
        )}
        <PathLine choice={{ base: here, newFolders }} root={root} />
      </div>
    </div>
  );
}

/**
 * Classes for a `Command` here. cmdk always keeps one item selected, so the selection shows
 * only while the Command has the keyboard or the pointer; otherwise its first item would look
 * chosen. A Place marked as the one shown keeps its own highlight.
 */
const QUIET_SELECTION =
  "bg-transparent [&:not(:focus-within):not(:hover)_[data-selected=true]:not([aria-current])]:bg-transparent";

const PLACE_ICONS: Record<Place["kind"], typeof FolderIcon> = {
  home: HomeIcon,
  workspaces: FolderIcon,
  computer: MonitorIcon,
};

/**
 * Home, the folders that hold Workspaces, and Computer, as a Command group: a column on a
 * desktop, a row of chips on a phone. The Command has no input, so it takes the focus itself
 * for the arrow keys and Enter.
 */
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
    <Command
      tabIndex={0}
      vimBindings={false}
      className={cn(
        QUIET_SELECTION,
        // Like a Command's input, the root shows the keyboard by its selected item, not a ring.
        "h-auto shrink-0 outline-none md:rounded-none md:border-r md:pr-2",
      )}
    >
      <CommandList
        label="Places"
        className="max-h-none overflow-x-auto overflow-y-hidden"
      >
        <CommandGroup
          heading="Places"
          className="overflow-visible p-0 max-md:[&_[cmdk-group-heading]]:hidden [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:gap-1 md:[&_[cmdk-group-items]]:flex-col"
        >
          {places.map((place) => {
            const Icon = PLACE_ICONS[place.kind];
            return (
              <CommandItem
                key={place.path}
                value={place.path}
                title={tildePath(place.path, root)}
                aria-current={here === place.path ? "location" : undefined}
                onSelect={() => onGo(place.path)}
                className="shrink-0 rounded-full border px-3 py-1 aria-[current=location]:bg-accent aria-[current=location]:font-medium md:rounded-sm md:border-transparent md:px-2"
              >
                <Icon />
                <span className="truncate">{place.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/**
 * The breadcrumbs, or, once the bar is clicked or tapped, a path field in their place, like a
 * file manager's address bar.
 */
function PathBar({
  choice,
  root,
  onChoose,
}: {
  choice: FolderChoice;
  root: string;
  onChoose: (choice: FolderChoice) => void;
}) {
  const [typing, setTyping] = useState(false);
  const typeButton = useRef<HTMLButtonElement>(null);
  // After Enter or Escape the focus comes back to the bar; after a click elsewhere it stays there.
  const refocus = useRef(false);
  const close = (returnFocus: boolean) => {
    refocus.current = returnFocus;
    setTyping(false);
  };
  useEffect(() => {
    if (typing || !refocus.current) return;
    refocus.current = false;
    typeButton.current?.focus();
  }, [typing]);
  if (typing) {
    return (
      <PathField
        choice={choice}
        root={root}
        onChoose={(next) => {
          close(true);
          onChoose(next);
        }}
        onEscape={() => close(true)}
        onCancel={() => close(false)}
      />
    );
  }
  return (
    <div className="flex min-h-8 items-center rounded-md border px-1">
      <Breadcrumbs
        choice={choice}
        root={root}
        onGo={(folder) => onChoose({ base: folder, newFolders: [] })}
        onTrim={(count) =>
          onChoose({ base: choice.base, newFolders: choice.newFolders.slice(0, count) })
        }
      />
      {/* The rest of the bar: clicking or tapping it turns the bar into the path field. A
          plain button, since it stretches over whatever room the breadcrumbs leave, which
          shadcn's Button with its fixed sizes doesn't. */}
      <button
        ref={typeButton}
        type="button"
        aria-label="Type a path"
        title="Type a path"
        onClick={() => setTyping(true)}
        className="flex min-h-7 min-w-8 flex-1 items-center justify-end self-stretch rounded-sm px-1 text-muted-foreground hover:bg-accent"
      >
        <TextCursorInputIcon className="size-4" />
      </button>
    </div>
  );
}

/**
 * A path to type or paste, with suggestions from the typed path's parent folder (hidden ones,
 * greyed, once the name being typed starts with `.`). Tab completes the highlighted
 * suggestion, or the first; Enter goes to the typed path, or to a suggestion picked with the
 * arrow keys, and never makes anything: a part of the path that doesn't exist becomes new
 * folders. Tab never leaves the field: pressed while the suggestions load, it completes once
 * they arrive. Escape, or leaving the field, goes back to the breadcrumbs unchanged.
 *
 * Hand-built rather than a `Command`: cmdk always selects a suggestion, so Enter would go
 * there instead of to the typed path, and it takes Home, End and Enter from the field.
 */
function PathField({
  choice,
  root,
  onChoose,
  onEscape,
  onCancel,
}: {
  choice: FolderChoice;
  root: string;
  onChoose: (choice: FolderChoice) => void;
  onEscape: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => {
    const shown = tildePath(choicePath(choice), root);
    return shown.endsWith("/") ? shown : `${shown}/`;
  });
  // Set only by the arrow keys, so Enter goes where was typed unless a suggestion was picked.
  const [highlight, setHighlight] = useState<number>();
  const [problem, setProblem] = useState<string>();
  // A Tab pressed before the suggestions for what's typed have loaded.
  const [tabWaiting, setTabWaiting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const problemId = useId();
  useEscapeIn(input, onEscape);

  const { head, parent, partial } = typedPath(text, root);
  const { listing } = useDirectoryListing(parent, { hidden: partial.startsWith(".") });
  const typed = partial.toLowerCase();
  const later = (name: string) => Number(!name.toLowerCase().startsWith(typed));
  // Names that start with what was typed first, each group in name order.
  const suggestions = (listing?.directories ?? [])
    .filter((d) => d.name.toLowerCase().includes(typed))
    .sort((a, b) => later(a.name) - later(b.name));
  const tabTarget = highlight ?? 0;

  const edit = (next: string) => {
    setText(next);
    setHighlight(undefined);
    setProblem(undefined);
    setTabWaiting(false);
  };
  if (tabWaiting && listing !== undefined) {
    // The suggestions a waiting Tab was for have arrived: complete now.
    const pick = suggestions[0];
    if (pick) edit(`${head}${pick.name}/`);
    else setTabWaiting(false);
  }
  const complete = (name: string) => {
    edit(`${head}${name}/`);
    input.current?.focus();
  };
  const go = (path: string) => {
    resolveTypedPath(path).then(onChoose, (e: unknown) =>
      setProblem(e instanceof Error ? e.message : String(e)),
    );
  };

  return (
    <div className="grid gap-1">
      <div className="relative">
        <Input
          ref={input}
          autoFocus
          role="combobox"
          aria-label="Folder path"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={suggestions.length > 0 ? listId : undefined}
          aria-activedescendant={
            highlight === undefined ? undefined : `${listId}-${highlight}`
          }
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : problemId}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="~/projects/new-app"
          className="h-8 font-mono text-sm"
          value={text}
          onFocus={(event) => event.target.select()}
          onBlur={onCancel}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            const count = suggestions.length;
            if (event.key === "Enter") {
              // Enter here must not submit the dialog's form.
              event.preventDefault();
              const picked = highlight === undefined ? undefined : suggestions[highlight];
              go(picked ? join(parent, picked.name) : expandPath(text, root));
            } else if (event.key === "Tab" && !event.shiftKey) {
              // Tab never moves the focus on: leaving would drop what's typed.
              event.preventDefault();
              const pick = suggestions[tabTarget];
              if (pick) complete(pick.name);
              else if (listing === undefined) setTabWaiting(true);
            } else if (event.key === "ArrowDown" && count > 0) {
              event.preventDefault();
              setHighlight((h) => (h === undefined ? 0 : (h + 1) % count));
            } else if (event.key === "ArrowUp" && count > 0) {
              event.preventDefault();
              setHighlight((h) =>
                h === undefined ? count - 1 : (h - 1 + count) % count,
              );
            }
          }}
        />
        {suggestions.length > 0 && (
          <div
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            className="absolute top-full z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {suggestions.map((directory, index) => (
              // The field handles the keys; a click or tap completes the suggestion.
              // biome-ignore lint/a11y/useKeyWithClickEvents: the field handles the keys
              <div
                key={directory.path}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === highlight}
                // Keeps the focus, and so the field, where it is.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => complete(directory.name)}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1 text-sm",
                  index === highlight ? "bg-accent" : "hover:bg-accent",
                  directory.name.startsWith(".") && "text-muted-foreground",
                )}
              >
                <FolderIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {directory.name}
                </span>
                {index === tabTarget && (
                  <kbd
                    aria-hidden
                    className="rounded border px-1 text-[10px] text-muted-foreground"
                  >
                    Tab
                  </kbd>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {problem && (
        <p id={problemId} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
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
    <Breadcrumb aria-label="Breadcrumbs" className="min-w-0">
      <BreadcrumbList className="min-h-7 gap-0.5 sm:gap-0.5">
        {all.map((crumb, index) => (
          <Fragment key={crumb.path}>
            {index > 0 && <BreadcrumbSeparator className="[&>svg]:size-3" />}
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button
                  type="button"
                  title={crumb.isNew ? `${crumb.path} (doesn't exist yet)` : crumb.path}
                  aria-current={index === all.length - 1 ? "location" : undefined}
                  onClick={crumb.go}
                  className={cn(
                    "rounded-sm px-1 hover:bg-accent aria-[current]:font-medium aria-[current]:text-foreground",
                    crumb.isNew && "italic",
                  )}
                >
                  {crumb.label}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
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

/** Inside a new folder there is nothing to list: it says the folder doesn't exist yet. */
function NewFolderNote({ name }: { name: string }) {
  return (
    <div className="grid min-h-40 flex-1 place-items-center content-center gap-1 rounded-md border p-6 text-center text-sm text-muted-foreground md:h-72 md:flex-none">
      <FolderPlusIcon className="size-6" />
      <span>
        <em className="text-foreground">{name}</em> doesn't exist yet. It'll be made along
        with the Workspace.
      </span>
      <span className="text-xs">Add another New folder to go deeper.</span>
    </div>
  );
}

/**
 * The shown folder's subfolders as a Command: its input narrows them, the arrow keys move
 * through them and Enter opens one. One with a Workspace says which.
 */
function FolderList({
  listing,
  error,
  filter,
  onFilter,
  workspaces,
  onGo,
}: {
  listing: DirectoryListing | undefined;
  error: string | undefined;
  filter: string;
  onFilter: (filter: string) => void;
  workspaces: WorkspaceState[];
  onGo: (folder: string) => void;
}) {
  const id = useId();
  const workspaceIn = new Map(workspaces.map((w) => [w.folder, w.name]));
  const shown = (listing?.directories ?? []).filter((d) =>
    d.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    // cmdk's own filter is fuzzy and reorders the list; this one keeps names that contain
    // what's typed, in name order.
    <Command
      label="Filter folders"
      shouldFilter={false}
      vimBindings={false}
      className={cn(QUIET_SELECTION, "min-h-40 flex-1 border md:h-72 md:flex-none")}
    >
      <CommandInput placeholder="Filter" value={filter} onValueChange={onFilter} />
      <CommandList label="Folders" className="max-h-none flex-1 p-1">
        {error && (
          <p role="alert" className="p-1 text-sm text-destructive">
            {error}
          </p>
        )}
        {!listing && !error && (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        )}
        {shown.map((directory, index) => {
          const workspace = workspaceIn.get(directory.path);
          const markId = `${id}-${index}`;
          return (
            <CommandItem
              key={directory.path}
              value={directory.path}
              onSelect={() => onGo(directory.path)}
              aria-describedby={workspace === undefined ? undefined : markId}
            >
              <FolderIcon />
              <span className="min-w-0 flex-1 truncate">{directory.name}</span>
              {workspace !== undefined && (
                // Hidden from the item's name, which stays the folder's; it is the description.
                <span
                  id={markId}
                  aria-hidden
                  className="max-w-[40%] shrink-0 truncate rounded-sm bg-secondary px-1.5 text-xs text-muted-foreground"
                >
                  <span className="sr-only">Workspace </span>
                  {workspace}
                </span>
              )}
              <ChevronRightIcon className="size-3 opacity-50" />
            </CommandItem>
          );
        })}
        {listing && shown.length === 0 && (
          <p className="p-1 text-sm text-muted-foreground">
            {filter.trim() ? "No folder matches" : "No subfolders"}
          </p>
        )}
      </CommandList>
    </Command>
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
  useEscapeIn(input, onCancel);

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 px-2">
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
