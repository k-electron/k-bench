import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SessionState } from "../../../src/shared/state-protocol.ts";
import { IconButton } from "./IconButton";
import { SessionIcon } from "./SessionIcon";
import { SessionMarker } from "./SessionMarker";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * One Tab: its trigger, named by the Session alone, then its marker slot and its × laid
 * over the trigger's right end, outside the trigger so neither joins its name and the
 * underline still runs the Tab's whole width.
 */
function Tab({
  session,
  shown,
  close,
}: {
  session: SessionState;
  shown: boolean;
  /** The × that removes the Tab; the Worker's Tab has none. */
  close?: ReactNode;
}) {
  return (
    <span className="relative flex h-full shrink-0 items-center">
      <TabsTrigger
        value={session.id}
        aria-label={session.name}
        aria-current={shown || undefined}
        className={cn(
          "h-full max-w-56 flex-none rounded-none pl-2.5 font-normal",
          // The line variant's underline, in the accent and inside the bar so it isn't clipped.
          "after:bg-primary group-data-[orientation=horizontal]/tabs:after:bottom-0",
          close ? "pr-12" : "pr-6",
        )}
      >
        <SessionIcon session={session} className="size-3.5" />
        <span className="truncate">{session.name}</span>
      </TabsTrigger>
      <span className="absolute right-1 flex items-center gap-1">
        <span className="pointer-events-none flex w-2 justify-center">
          <SessionMarker session={session} />
        </span>
        {close}
      </span>
    </span>
  );
}

/**
 * The right Pane's Tabs, on shadcn's `Tabs` (line variant): the Worker first, with no ×,
 * then each Other Session the owner opened there, each with a × that removes only the Tab
 * (the Session keeps running). There is no `TabsContent`: the Pane below shows the chosen
 * Session at once, with no animation.
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
    <Tabs
      value={shownId ?? ""}
      onValueChange={(id) => (id === worker?.id ? onShowWorker() : onShowTab(id))}
      // Arrow keys only move between Tabs; Enter or Space shows one, as a click does.
      activationMode="manual"
      className="h-full min-w-0 gap-0"
    >
      <TabsList
        variant="line"
        className="h-full w-full justify-start gap-0 overflow-x-auto overflow-y-hidden p-0 group-data-[orientation=horizontal]/tabs:h-full"
      >
        {worker && <Tab session={worker} shown={shownId === worker.id} />}
        {tabs.map((session) => (
          <Tab
            key={session.id}
            session={session}
            shown={shownId === session.id}
            close={
              <IconButton
                label={`Close tab ${session.name}`}
                tooltip="Close tab (the Session keeps running)"
                className="size-5"
                onClick={() => onCloseTab(session.id)}
              >
                <XIcon className="size-3" />
              </IconButton>
            }
          />
        ))}
      </TabsList>
    </Tabs>
  );
}
