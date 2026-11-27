import type { SessionState, WorkspaceState } from "../../../src/shared/state-protocol.ts";
import { SessionIcon } from "./SessionIcon";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { WorkspaceTile } from "./WorkspaceTile";

/**
 * The desktop's top bar, a `Breadcrumb`: the Open Workspace's tile and name (the page's
 * heading, with its folder as a tooltip), then the Session with the keyboard and its icon.
 */
export function DesktopTitle({
  workspace,
  session,
}: {
  workspace: WorkspaceState;
  /** The Session in the Pane that has the keyboard, if that Pane shows one. */
  session: SessionState | undefined;
}) {
  return (
    <Breadcrumb className="min-w-0 px-1">
      <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-2">
        <BreadcrumbItem className="min-w-0">
          <WorkspaceTile workspace={workspace} />
          <h1
            className="truncate text-sm font-medium text-foreground"
            title={workspace.folder}
          >
            {workspace.name}
          </h1>
        </BreadcrumbItem>
        {session && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <SessionIcon session={session} className="size-3.5" />
              <BreadcrumbPage className="truncate text-sm text-muted-foreground">
                {session.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
