import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useActions } from "@/useAppState";
import type { State, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import type { CreateSessionInput } from "../api";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { EditWorkspaceDialog, type WorkspaceEdit } from "./EditWorkspaceDialog";
import { NewSessionDialog } from "./NewSessionDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { SessionRow } from "./SessionRow";
import { UnsupportedListDialog } from "./UnsupportedListDialog";
import { Button } from "./ui/button";
import { WorkspaceRow } from "./WorkspaceRow";

interface SidebarProps {
  state: State | undefined;
  /** The Session in the Focused Pane. */
  openId: string | undefined;
  onOpen: (sessionId: string) => void;
  onOpenInOtherPane: (sessionId: string) => void;
  /**
   * Creates a Session (a Claude Session with `claude`) and opens it; rejects with the
   * server's refusal.
   */
  onCreateSession: (workspaceId: string, input: CreateSessionInput) => Promise<void>;
  /** Why the last Session restart was refused, if it was. */
  error?: string;
  /** Sizing and placement, which differ between the desktop sidebar and the phone drawer. */
  className?: string;
}

/**
 * The tree of Workspaces and their Sessions. Opening a Session is up to the caller; every
 * other action comes from `useActions`.
 */
export function Sidebar({
  state,
  openId,
  onOpen,
  onOpenInOtherPane,
  onCreateSession,
  error,
  className,
}: SidebarProps) {
  const actions = useActions();
  const [creating, setCreating] = useState<WorkspaceState>();
  const [showUnsupported, setShowUnsupported] = useState(false);
  const [dialog, setDialog] = useState<{
    workspace: WorkspaceState;
    action: WorkspaceEdit | "delete";
  }>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // On a phone a drag starts with a short press, so scrolling the sidebar still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const workspaces = state?.workspaces ?? [];

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = workspaces.map((w) => w.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    ids.splice(to, 0, ...ids.splice(from, 1));
    void actions.reorderWorkspaces(ids);
  };

  return (
    <nav
      aria-label="Workspaces"
      className={cn("flex shrink-0 flex-col gap-2 border-r bg-card p-2", className)}
    >
      <NewWorkspaceDialog onCreate={actions.createWorkspace} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={workspaces.map((w) => w.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-3 overflow-y-auto">
            {workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                onCreateSession={() => setCreating(workspace)}
                onAction={(action) => setDialog({ workspace, action })}
              >
                <ul>
                  {workspace.sessions.map((session) => (
                    <li key={session.id}>
                      <SessionRow
                        session={session}
                        isOpen={session.id === openId}
                        onOpen={() => onOpen(session.id)}
                        onOpenInOtherPane={() => onOpenInOtherPane(session.id)}
                      />
                    </li>
                  ))}
                </ul>
              </WorkspaceRow>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {creating && (
        <NewSessionDialog
          workspace={creating}
          onCreate={(input) => onCreateSession(creating.id, input)}
          onClose={() => setCreating(undefined)}
        />
      )}
      {dialog && dialog.action !== "delete" && (
        <EditWorkspaceDialog
          workspace={dialog.workspace}
          edit={dialog.action}
          onSave={(changes) => actions.updateWorkspace(dialog.workspace.id, changes)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.action === "delete" && (
        <DeleteWorkspaceDialog
          workspace={dialog.workspace}
          onDelete={() => actions.deleteWorkspace(dialog.workspace.id)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {error && (
        <p role="alert" className="px-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-auto justify-start text-muted-foreground"
        onClick={() => setShowUnsupported(true)}
      >
        <TriangleAlertIcon />
        Unsupported
      </Button>
      {showUnsupported && (
        <UnsupportedListDialog
          state={state}
          onOpenSession={(id) => {
            setShowUnsupported(false);
            onOpen(id);
          }}
          onClose={() => setShowUnsupported(false)}
        />
      )}
    </nav>
  );
}
