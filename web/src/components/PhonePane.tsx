import type { PhonePaneContent } from "../usePhonePane";
import { Pane } from "./Pane";

/** The phone's one Pane: the Session on screen, or why there is none. */
export function PhonePane({
  content,
  emptyMessage,
}: {
  content: PhonePaneContent;
  /** Shown when no Session is on screen. */
  emptyMessage: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings form styling; this only names the slot
    <div role="group" aria-label="Pane" className="min-h-0 flex-1">
      {content.kind === "session" ? (
        <Pane key={content.session.id} session={content.session} focused />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {content.kind === "deleted" ? (
            <p role="status" aria-label="Pane notice">
              This Session was deleted. {emptyMessage}
            </p>
          ) : (
            emptyMessage
          )}
        </div>
      )}
    </div>
  );
}

/** The phone's `Workspace › Session` label, beside the Menu button. */
export function PhonePaneLabel({ content }: { content: PhonePaneContent }) {
  if (content.kind !== "session") return null;
  return (
    <div
      role="note"
      aria-label="Pane label"
      className="min-w-0 flex-1 truncate px-2 text-sm"
    >
      <span className="text-muted-foreground">{content.workspace} ›</span>{" "}
      <span>{content.session.name}</span>
    </div>
  );
}
