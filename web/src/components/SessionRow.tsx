import {
  Columns2Icon as ColumnsIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useActions } from "@/useAppState";
import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { AGENT_STATE_LABEL, agentDisplayState } from "../agentState";
import { ClaudeGlyph } from "./ClaudeGlyph";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface SessionRowProps {
  session: SessionState;
  isOpen: boolean;
  onOpen: () => void;
  onOpenInOtherPane: () => void;
}

/**
 * One Session in the sidebar: the row to open it, plus its row menu. To add a menu action,
 * add a `DropdownMenuItem` below (and any dialog it needs beside the existing ones).
 */
export function SessionRow({
  session,
  isOpen,
  onOpen,
  onOpenInOtherPane,
}: SessionRowProps) {
  const actions = useActions();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Pulsing means "needs you": a Bell, in blue, or a Claude Agent Waiting for you, in orange.
  const pulsing = session.bell;
  // A Claude Agent shows what it is doing; anything else just whether it runs.
  const agentState = agentDisplayState(session);
  const waiting = agentState === "waiting";

  return (
    <div
      className={cn(
        "group flex items-center rounded-md",
        agentState && `row-agent-${agentState}`,
        pulsing && "row-pulse",
        waiting && "row-waiting",
      )}
    >
      <span
        role="img"
        aria-label={`${session.name} ${agentState ? AGENT_STATE_LABEL[agentState].toLowerCase() : session.status}`}
        className={cn(
          "ml-4 size-2 shrink-0 rounded-full",
          (agentState ?? session.status) === "stopped" &&
            "border border-muted-foreground",
          (agentState === "idle" || (!agentState && session.status === "running")) &&
            "bg-emerald-500",
          agentState === "working" &&
            "animate-spin border-2 border-emerald-500 border-t-transparent motion-reduce:animate-none",
          waiting && "animate-pulse bg-orange-500 motion-reduce:animate-none",
        )}
      />
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "min-w-0 flex-1 justify-start font-normal",
          isOpen && "bg-accent",
          session.status === "stopped" && "text-muted-foreground",
        )}
        aria-current={isOpen ? "true" : undefined}
        // ⌘-click opens it in the other Pane.
        onClick={(event) => (event.metaKey ? onOpenInOtherPane() : onOpen())}
      >
        {/* A speech bubble for a conversation, a terminal for a terminal. */}
        {session.interface === "agent" ? <MessageSquareIcon /> : <TerminalIcon />}
        <span className="truncate">{session.name}</span>
      </Button>
      {/* Beside the row's button, not inside it, so it stays out of the button's name. */}
      {session.kind === "claude" && (
        <ClaudeGlyph label={`${session.name} is a Claude Session`} />
      )}
      {/* The pulse is visual; this says it to a screen reader and to tests. */}
      {pulsing && (
        <span role="status" className="sr-only">{`${session.name} needs you`}</span>
      )}
      {waiting && (
        <span role="status" className="sr-only">
          {`${session.name} is waiting for you`}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`Actions for ${session.name}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpenInOtherPane}>
            <ColumnsIcon />
            Open in other pane
          </DropdownMenuItem>
          {session.status === "stopped" && (
            <DropdownMenuItem onSelect={() => void actions.restartSession(session.id)}>
              <RotateCcwIcon />
              Restart
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameSessionDialog
        open={renaming}
        onOpenChange={setRenaming}
        currentName={session.name}
        onRename={(name) => actions.renameSession(session.id, name)}
      />
      <DeleteSessionDialog
        open={deleting}
        onOpenChange={setDeleting}
        sessionName={session.name}
        onDelete={() => actions.deleteSession(session.id)}
      />
    </div>
  );
}
