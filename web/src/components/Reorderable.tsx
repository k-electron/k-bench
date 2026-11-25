import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";

/**
 * A list whose items (`ids`, each a `useSortable` row inside `children`) reorder by
 * dragging the row itself, with no handle. A drag starts once the mouse moves a few pixels,
 * or after a short press on touch, so a click or tap still opens the row and a swipe still
 * scrolls. The lifted row casts a shadow and the others slide aside.
 */
export function Reorderable({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  /** Every id, in the new order. */
  onReorder: (ids: string[]) => Promise<void>;
  children: ReactNode;
}) {
  // The mouse sensor, not the pointer one, so a finger's swipe never starts a drag: on touch
  // only the press-and-hold does.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * A row of a `Reorderable` list: `row` goes on its list item, which moves, and `handle` on
 * its main button, which is what a drag picks up.
 */
export type SortableRow = {
  row: { ref: (node: HTMLElement | null) => void; style: CSSProperties };
  handle: Record<string, unknown> & { ref: (node: HTMLElement | null) => void };
  isDragging: boolean;
};

export function useSortableRow(id: string): SortableRow {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return {
    row: {
      ref: setNodeRef,
      style: { transform: CSS.Transform.toString(transform), transition },
    },
    handle: { ref: setActivatorNodeRef, ...attributes, ...listeners },
    isDragging,
  };
}

/** The classes of a row while it is lifted by a drag. */
export const LIFTED = "relative z-20 bg-card shadow-lg";
