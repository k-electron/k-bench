import { cn } from "@/lib/utils";
import type { SessionState } from "../../../src/shared/state-protocol.ts";
import {
  AGENT_STATE_LABEL,
  type AgentDisplayState,
  agentDisplayState,
  formatElapsed,
  useNow,
} from "../agentState";
import { paneColumns } from "../layout";
import type { PaneView } from "../usePaneView";

const STATE_GLYPH: Record<AgentDisplayState, string> = {
  idle: "●",
  working: "◌",
  waiting: "●",
  stopped: "○",
};

const STATE_COLOR: Record<AgentDisplayState, string> = {
  idle: "text-emerald-500",
  working: "text-emerald-500",
  waiting: "text-orange-500",
  stopped: "text-muted-foreground",
};

/**
 * A Claude Agent's state beside its name: `● Idle`, `◌ Working · 42s`, `● Waiting for you`,
 * `○ Stopped`. The seconds are those of the turn now running, which Waiting for you does not
 * restart. Nothing for a Session that is not a Claude Agent.
 */
function AgentStateLabel({ session }: { session: SessionState }) {
  const state = agentDisplayState(session);
  const turnStartedAt = session.agent?.turnStartedAt;
  const ticking = state === "working" && turnStartedAt !== undefined;
  const now = useNow(ticking);
  if (!state) return null;
  return (
    <span className={cn("ml-2 whitespace-nowrap", STATE_COLOR[state])}>
      <span aria-hidden="true">{STATE_GLYPH[state]} </span>
      <span className="text-foreground">{AGENT_STATE_LABEL[state]}</span>
      {ticking && (
        <span className="text-muted-foreground">
          {" "}
          · {formatElapsed(now - turnStartedAt)}
        </span>
      )}
    </span>
  );
}

interface PaneLabelsProps {
  panes: PaneView[];
  paneCount: 1 | 2;
  ratio: number;
  className?: string;
}

/**
 * The row of labels in the top bar, one over each Pane showing a Session, reading
 * `Workspace › Session`. It uses the Panes' own grid columns, so each label starts at its
 * Pane's left edge, divider drags included. A label is cut off with an ellipsis at about
 * two thirds of its Pane's width, which also keeps the right-hand one clear of the toggle.
 */
export function PaneLabels({ panes, paneCount, ratio, className }: PaneLabelsProps) {
  const two = paneCount === 2;
  const [first, second] = panes;
  const label = (index: number, { content, focused }: PaneView) => {
    if (content.kind !== "session") return <div />;
    return (
      <div
        role="note"
        aria-label={`Pane ${index + 1} label`}
        className={cn("max-w-2/3 truncate px-2 text-sm", two && !focused && "opacity-50")}
      >
        <span className="text-muted-foreground">{content.workspace} ›</span>{" "}
        <span>{content.session.name}</span>
        <AgentStateLabel session={content.session} />
      </div>
    );
  };
  return (
    <div
      className={cn("grid min-w-0 items-center", className)}
      style={{ gridTemplateColumns: paneColumns(paneCount, ratio) }}
    >
      {first ? label(0, first) : <div />}
      {two && second && (
        <>
          <div />
          {label(1, second)}
        </>
      )}
    </div>
  );
}
