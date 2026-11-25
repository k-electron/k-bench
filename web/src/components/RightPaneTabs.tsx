import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { SessionIcon } from "./SessionIcon";

/** The amber dot on a tab whose Session rang the bell while it was hidden. */
function BellDot({ session }: { session: SessionState }) {
  if (!session.bell) return null;
  const label = `${session.name} rang the bell`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="size-2 shrink-0 rounded-full bg-amber-400"
    />
  );
}

function Tab({
  session,
  shown,
  onShow,
  close,
}: {
  session: SessionState;
  shown: boolean;
  onShow: () => void;
  /** The × that removes the tab; the Worker's tab has none. */
  close?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-sm",
        shown
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <button
        type="button"
        aria-current={shown || undefined}
        title={session.name}
        className="flex max-w-48 items-center gap-1.5 px-1.5"
        onClick={onShow}
      >
        <SessionIcon session={session} className="size-3" />
        <span className="truncate">{session.name}</span>
      </button>
      <BellDot session={session} />
      {close}
    </span>
  );
}

/**
 * The right Pane's slim tab bar: the Worker first, with no ×, then each Other Session the
 * owner opened there, each with a × that removes only the tab (the Session keeps running).
 * Each tab shows a Bell dot when its Session rang the bell.
 */
export function RightPaneTabs({
  worker,
  tabs,
  shownId,
  onShowWorker,
  onShowTab,
  onCloseTab,
}: {
  worker: SessionState | undefined;
  tabs: SessionState[];
  /** The Session the right Pane shows. */
  shownId: string | undefined;
  onShowWorker: () => void;
  onShowTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {worker && (
        <Tab session={worker} shown={shownId === worker.id} onShow={onShowWorker} />
      )}
      {tabs.map((session) => (
        <Tab
          key={session.id}
          session={session}
          shown={shownId === session.id}
          onShow={() => onShowTab(session.id)}
          close={
            <button
              type="button"
              aria-label={`Close tab ${session.name}`}
              title="Close tab (the Session keeps running)"
              className="px-1 hover:text-foreground"
              onClick={() => onCloseTab(session.id)}
            >
              <XIcon className="size-3" />
            </button>
          }
        />
      ))}
    </div>
  );
}
