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
import { useState } from "react";
import type { AppState, WorkspaceState } from "@/api";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { EditWorkspaceDialog, type WorkspaceEdit } from "./EditWorkspaceDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { SessionRow } from "./SessionRow";
import { WorkspaceRow } from "./WorkspaceRow";

interface SidebarProps {
  state: AppState | undefined;
  openId: string | undefined;
  onOpen: (sessionId: string) => void;
  onCreateWorkspace: (input: { folder: string; name?: string }) => Promise<void>;
  onCreateSession: (workspaceId: string) => Promise<void>;
  onReorderWorkspaces: (ids: string[]) => Promise<void>;
  onUpdateWorkspace: (
    id: string,
    changes: { name?: string; folder?: string },
  ) => Promise<void>;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onRestartSession: (sessionId: string) => Promise<void>;
  /** Why the last action failed, if it did. */
  error?: string;
}

/** The tree of Workspaces and their Sessions. */
export function Sidebar({
  state,
  openId,
  onOpen,
  onCreateWorkspace,
  onCreateSession,
  onReorderWorkspaces,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onRenameSession,
  onDeleteSession,
  onRestartSession,
  error,
}: SidebarProps) {
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
    void onReorderWorkspaces(ids);
  };

  return (
    <nav
      aria-label="Workspaces"
      className="flex w-64 shrink-0 flex-col gap-2 border-r bg-card p-2"
    >
      <NewWorkspaceDialog onCreate={onCreateWorkspace} />
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
                onCreateSession={() => void onCreateSession(workspace.id)}
                onAction={(action) => setDialog({ workspace, action })}
              >
                <ul>
                  {workspace.sessions.map((session) => (
                    <li key={session.id}>
                      <SessionRow
                        session={session}
                        isOpen={session.id === openId}
                        onOpen={() => onOpen(session.id)}
                        onRename={(name) => onRenameSession(session.id, name)}
                        onDelete={() => onDeleteSession(session.id)}
                        onRestart={() => onRestartSession(session.id)}
                      />
                    </li>
                  ))}
                </ul>
              </WorkspaceRow>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {dialog && dialog.action !== "delete" && (
        <EditWorkspaceDialog
          workspace={dialog.workspace}
          edit={dialog.action}
          onSave={(changes) => onUpdateWorkspace(dialog.workspace.id, changes)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.action === "delete" && (
        <DeleteWorkspaceDialog
          workspace={dialog.workspace}
          onDelete={() => onDeleteWorkspace(dialog.workspace.id)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {error && (
        <p role="alert" className="px-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </nav>
  );
}
