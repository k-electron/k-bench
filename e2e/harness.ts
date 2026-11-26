import { createServer } from "node:net";
import { basename, relative, resolve } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { type SessionRow, Store } from "../src/server/store.ts";
import { createTestInstance, type TestInstance } from "../test/harness/instance.ts";
import { pollUntil } from "../test/harness/poll.ts";
import { echoCommand } from "../test/harness/terminal.ts";
import { attachedClientCount, typeIntoSession } from "../test/harness/tmux.ts";

const WEB_DIR = resolve("dist/web");
const LOGIN = "owner@example.com";

/** What a Session's marker says after its name, for each marker. */
const MARKER_LABELS = {
  waiting: "is waiting for you",
  bell: "rang the bell",
  working: "is working",
  idle: "is idle",
};

/**
 * The app as the owner sees it, found by role and accessible name. Later tickets add
 * helpers here as they add UI.
 */
export class AppPage {
  readonly page: Page;
  /** The picker root the server was started with: Home in the folder picker. */
  readonly home: string;

  constructor(page: Page, home: string) {
    this.page = page;
    this.home = home;
  }

  /** The sidebar listing Workspaces and their Sessions. */
  get sidebar(): Locator {
    return this.page.getByRole("navigation", { name: "Workspaces" });
  }

  /** On the phone: the sidebar's drawer, a sheet from the left (absent until the menu button opens it). */
  get drawer(): Locator {
    return this.sidebar;
  }

  /** On the phone: opens the drawer from the menu button. */
  async openDrawer(): Promise<void> {
    await this.page.getByRole("button", { name: "Menu", exact: true }).tap();
    // Done once it has slid in from the left edge, so its rows are where they will stay.
    await expect.poll(async () => (await this.drawer.boundingBox())?.x).toBe(0);
  }

  /** On the phone: a button in the extra-keys row (Esc, Tab, Shift Tab, Ctrl, Up, ...). */
  extraKey(name: string): Locator {
    return this.page
      .getByRole("group", { name: "Extra keys", exact: true })
      .getByRole("button", { name, exact: true });
  }

  /** On the phone, while the on-screen keyboard is up: a key in the compact overlay over the terminal. */
  overlayKey(name: string): Locator {
    return this.page
      .getByRole("group", { name: "Typing keys", exact: true })
      .getByRole("button", { name, exact: true });
  }

  /** A Session's row in the sidebar: the button that opens it. */
  session(name: string): Locator {
    return this.sidebar.getByRole("button", { name, exact: true });
  }

  /** A Session's whole row in the sidebar: its icon, name, "stopped" label, Bell and menu. */
  sessionRow(name: string): Locator {
    return this.sidebar
      .getByRole("listitem")
      .filter({ has: this.page.getByRole("button", { name, exact: true }) })
      .filter({ hasNot: this.page.getByRole("list") });
  }

  /** Opens a Session row's menu and picks `item` (for example "Rename" or "Delete"). */
  async sessionMenu(sessionName: string, item: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `Actions for ${sessionName}`, exact: true })
      .click();
    await this.page.getByRole("menuitem", { name: item, exact: true }).click();
  }

  /** The terminal showing the named Session. */
  terminal(sessionName: string): Locator {
    return this.page.getByRole("region", {
      name: `Terminal ${sessionName}`,
      exact: true,
    });
  }

  /** On a phone: the `Workspace › Session` title beside the Menu button. */
  get phoneTitle(): Locator {
    return this.page.getByRole("main").getByRole("heading", { level: 1 });
  }

  /**
   * On a phone: the sheet listing the Open Workspace's Sessions, opened from the title. It is
   * named after the Workspace, so it is found by its list of Sessions.
   */
  get sessionsSheet(): Locator {
    return this.page.getByRole("dialog").filter({
      has: this.page.getByRole("list", { name: "Sessions", exact: true }),
    });
  }

  /** On a phone: taps the title to open the Sessions sheet. */
  async openSessionsSheet(): Promise<void> {
    await this.phoneTitle.getByRole("button").tap();
    // Done once it has slid up to the bottom edge, so its rows are where they will stay.
    const height = this.page.viewportSize()?.height;
    await expect
      .poll(async () => {
        const box = await this.sessionsSheet.boundingBox();
        return box && Math.round(box.y + box.height);
      })
      .toBe(height);
  }

  /** On a phone: a Session's row in the Sessions sheet. */
  sheetRow(name: string): Locator {
    return this.sessionsSheet.getByRole("button", { name, exact: true });
  }

  /** On a phone: the dot on the title's Workspace name, for a Bell elsewhere in it. */
  get titleBell(): Locator {
    return this.phoneTitle.getByRole("img", {
      name: "Another session here rang the bell",
      exact: true,
    });
  }

  /** On a phone: the dot on the Menu button, for a Bell in another Workspace. */
  get menuBell(): Locator {
    return this.page.getByRole("img", {
      name: "A session in another workspace rang the bell",
      exact: true,
    });
  }

  /** On a desktop or tablet: the left Pane (always the Prime) or the right one. */
  pane(side: "left" | "right"): Locator {
    const name = side === "left" ? "Left Pane" : "Right Pane";
    return this.page.getByRole("group", { name, exact: true });
  }

  /** The terminal showing the named Session, found inside the left or right Pane. */
  terminalIn(side: "left" | "right", sessionName: string): Locator {
    return this.pane(side).getByRole("region", {
      name: `Terminal ${sessionName}`,
      exact: true,
    });
  }

  /** A tab in the right Pane's tab bar: "Worker", or an Other Session's name. */
  rightTab(name: string): Locator {
    return this.pane("right").getByRole("tab", { name, exact: true });
  }

  /** The × on an Other Session's tab in the right Pane. */
  closeTabButton(name: string): Locator {
    return this.pane("right").getByRole("button", {
      name: `Close tab ${name}`,
      exact: true,
    });
  }

  /** The Bell dot on a right Pane tab; present only while its Session's Bell is raised. */
  tabBell(name: string): Locator {
    return this.pane("right").getByRole("img", {
      name: `${name} rang the bell`,
      exact: true,
    });
  }

  /** On a desktop or tablet: the Open Workspace's name in the top bar. */
  get workspaceTitle(): Locator {
    return this.page.getByRole("main").getByRole("heading", { level: 1 });
  }

  /** On a desktop or tablet: the Session with the keyboard, after the top bar's Workspace. */
  get headerSession(): Locator {
    return this.page
      .getByRole("main")
      .getByRole("navigation", { name: "breadcrumb", exact: true })
      .getByRole("link");
  }

  /** Opens a Workspace by clicking its name in the sidebar. */
  async openWorkspace(name: string): Promise<void> {
    await this.workspace(name).getByRole("button", { name, exact: true }).click();
  }

  /** The draggable divider between the two Panes. */
  get divider(): Locator {
    return this.page.getByRole("separator", { name: "Resize panes" });
  }

  /** Drags the divider horizontally by `dx` pixels with the mouse. */
  async dragDivider(dx: number): Promise<void> {
    const box = await this.divider.boundingBox();
    if (!box) throw new Error("The divider is not visible");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx, y, { steps: 10 });
    await this.page.mouse.up();
  }

  /**
   * Drags the divider to where the left Pane takes `share` of the two Panes' width, as
   * worked out from where the Panes are now.
   */
  async dragDividerTo(share: number): Promise<void> {
    const [divider, left, right] = await Promise.all([
      this.divider.boundingBox(),
      this.pane("left").boundingBox(),
      this.pane("right").boundingBox(),
    ]);
    if (!divider || !left || !right) throw new Error("Both Panes should be open");
    const target = left.x + share * (right.x + right.width - left.x);
    await this.dragDivider(target - (divider.x + divider.width / 2));
  }

  /** The divider's position: the left Pane's share of the width, in percent. */
  async dividerPercent(): Promise<number> {
    return Number(await this.divider.getAttribute("aria-valuenow"));
  }

  /** Drags the divider to a few pixels from the left or right edge, which shuts that Pane. */
  async shutPane(side: "left" | "right"): Promise<void> {
    const [divider, pane] = await Promise.all([
      this.divider.boundingBox(),
      this.pane(side).boundingBox(),
    ]);
    if (!divider || !pane) throw new Error(`The ${side} Pane is not open`);
    const edge = side === "left" ? pane.x + 5 : pane.x + pane.width - 5;
    await this.dragDivider(edge - (divider.x + divider.width / 2));
  }

  /** The rail a shut Pane leaves, which reopens it when clicked. */
  rail(side: "left" | "right", sessionName: string): Locator {
    return this.pane(side).getByRole("button", {
      name: `Show ${sessionName}`,
      exact: true,
    });
  }

  /** The Bell dot on a shut Pane's rail; present only while its Session has a Bell. */
  railBell(side: "left" | "right", sessionName: string): Locator {
    return this.pane(side).getByRole("img", {
      name: `${sessionName} rang the bell`,
      exact: true,
    });
  }

  /** A Session's row, found only while it is running, or only while it is Stopped. */
  sessionStatus(name: string, status: "running" | "stopped"): Locator {
    return status === "stopped"
      ? this.sessionRow(name).filter({ hasText: "stopped" })
      : this.sessionRow(name).filter({ hasNotText: "stopped" });
  }

  private sizeProbes = 0;

  /**
   * Asks the shell how big its terminal is (`tput`), so the answer is what the Session
   * really sees, not what the browser believes.
   *
   * An answer can be drawn over before it is read: tmux hands a burst of resizes (a divider
   * drag) to the shell at most every quarter second or so, and a shell that redraws its
   * prompt when the last one lands can draw it over the line it just printed. So a probe
   * that goes unanswered is asked again, with a fresh tag.
   */
  async terminalSize(terminal: Locator): Promise<{ cols: number; rows: number }> {
    let size = { cols: 0, rows: 0 };
    await expect(async () => {
      const tag = `size${++this.sizeProbes}`;
      await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
      await this.page.keyboard.type(`echo "${tag}=$(tput cols)x$(tput lines)"`);
      await this.page.keyboard.press("Enter");
      await expect(terminal).toContainText(new RegExp(`${tag}=\\d+x\\d+`), {
        timeout: 2_000,
      });
      const text = (await terminal.textContent()) ?? "";
      const [, cols, rows] = new RegExp(`${tag}=(\\d+)x(\\d+)`).exec(text) ?? [];
      size = { cols: Number(cols), rows: Number(rows) };
    }).toPass({ timeout: 10_000 });
    return size;
  }

  async createWorkspace(folder: string, options: { name?: string } = {}): Promise<void> {
    await this.page.getByRole("button", { name: "New Workspace" }).click();
    await this.pickFolder(folder);
    if (options.name !== undefined) {
      await this.page.getByRole("textbox", { name: "Name" }).fill(options.name);
    }
    await this.page.getByRole("button", { name: "Create Workspace" }).click();
    // Done once the dialog has animated out (until then it hides the rest of the page from
    // the accessibility tree), or once it shows why it refused. On the phone the drawer it
    // was opened from is a dialog too, and stays open.
    await expect(
      this.page
        .getByRole("dialog")
        .filter({ hasNot: this.page.getByRole("alert") })
        .filter({ hasNot: this.sidebar }),
    ).toHaveCount(0);
  }

  /** The open dialog's folder picker: Places, breadcrumbs, filter and the folder list. */
  get folderPicker(): Locator {
    // Not the phone's drawer, a dialog too, which stays open under it.
    return this.page.getByRole("dialog").filter({ hasNot: this.sidebar });
  }

  /** The Places in the folder picker (Home, folders holding Workspaces, Computer). */
  place(name: string): Locator {
    return this.folderPicker
      .getByRole("listbox", { name: "Places" })
      .getByRole("option", { name, exact: true });
  }

  /** A subfolder in the folder picker's list. */
  folderRow(name: string): Locator {
    return this.folderPicker
      .getByRole("listbox", { name: "Folders" })
      .getByRole("option", { name, exact: true });
  }

  /** A suggestion under the folder picker's path field. */
  pathSuggestion(name: string): Locator {
    return this.folderPicker
      .getByRole("listbox", { name: "Suggestions" })
      .getByRole("option", { name, exact: true });
  }

  /** A crumb in the folder picker's breadcrumbs (Home is `~`). */
  breadcrumb(name: string): Locator {
    return this.folderPicker
      .getByRole("navigation", { name: "Breadcrumbs" })
      .getByRole("button", { name, exact: true });
  }

  /** In the open folder picker, names a New folder; Enter steps into it. */
  async newFolder(name: string): Promise<void> {
    await this.folderPicker
      .getByRole("button", { name: "New folder", exact: true })
      .click();
    const input = this.folderPicker.getByRole("textbox", { name: "New folder name" });
    await input.fill(name);
    await input.press("Enter");
  }

  /** In the open folder picker, goes to Home and steps down into `folder`, one folder at a time. */
  async pickFolder(folder: string): Promise<void> {
    await this.place("Home").click();
    for (const name of relative(this.home, folder).split("/").filter(Boolean)) {
      await this.folderRow(name).click();
    }
    const here = folder === this.home ? "~" : basename(folder);
    await expect(this.breadcrumb(here)).toHaveAttribute("aria-current", "location");
  }

  /** A Workspace's heading in the sidebar. */
  workspace(name: string): Locator {
    return this.sidebar.getByRole("heading", { name, exact: true });
  }

  /** In the collapsed sidebar: a Workspace's tile, which opens it. */
  workspaceTile(name: string): Locator {
    return this.sidebar.getByRole("button", { name, exact: true });
  }

  /** Collapses the sidebar to a column of tiles. */
  async collapseSidebar(): Promise<void> {
    await this.sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  }

  /** The button at the top of the collapsed sidebar that brings the tree back. */
  get expandSidebarButton(): Locator {
    return this.sidebar.getByRole("button", { name: "Expand sidebar" });
  }

  /**
   * Expands the collapsed sidebar, clicking again if a click went unheard, as a person
   * would. For 50ms after a drop the drag library swallows every click (it is there to eat
   * the click the drop itself makes), and on a busy machine that window runs late, so a
   * click straight after `dragOnto` can land in it.
   */
  async expandSidebar(): Promise<void> {
    const collapse = this.sidebar.getByRole("button", { name: "Collapse sidebar" });
    await expect(async () => {
      if (await this.expandSidebarButton.isVisible())
        await this.expandSidebarButton.click();
      await expect(collapse).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }

  /**
   * A Session's marker showing `marker`, by its label: on its sidebar row, its right Pane
   * Tab, or, on a phone, the title or its row in the Sessions sheet. Present only while the
   * Session shows that marker there.
   */
  marker(
    where: "sidebar" | "tab" | "title" | "sheet",
    sessionName: string,
    marker: keyof typeof MARKER_LABELS,
  ): Locator {
    const scope = {
      sidebar: this.sidebar,
      tab: this.pane("right"),
      title: this.phoneTitle,
      sheet: this.sessionsSheet,
    }[where];
    return scope.getByRole("img", {
      name: `${sessionName} ${MARKER_LABELS[marker]}`,
      exact: true,
    });
  }

  /** The Bell badge on a Session's row; present only while its Bell is raised. */
  bellBadge(sessionName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${sessionName} rang the bell`,
      exact: true,
    });
  }

  /** The Bell dot on a folded Workspace's tile: some Session in it rang the bell. */
  workspaceBellHint(workspaceName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${workspaceName} has a session that rang the bell`,
      exact: true,
    });
  }

  /**
   * The pulsing dot on a folded Workspace's tile: some Session in it is Waiting. It takes
   * the place of the Bell dot.
   */
  workspaceWaitingHint(workspaceName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${workspaceName} has a session waiting for you`,
      exact: true,
    });
  }

  /** The warning mark on a Missing Workspace's tile. */
  missingMark(workspaceName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${workspaceName} is Missing`,
      exact: true,
    });
  }

  /**
   * The note under the Open Workspace when it is Missing, with its Change folder button;
   * absent when its folder exists or it is folded.
   */
  missingNotice(workspaceName: string): Locator {
    return this.sidebar
      .getByRole("listitem")
      .filter({
        has: this.page.getByRole("heading", { name: workspaceName, exact: true }),
      })
      .getByRole("note");
  }

  /** The Workspaces' names in sidebar order. */
  async workspaceNames(): Promise<string[]> {
    return accessibleNames(this.sidebar.getByRole("heading").getByRole("button"));
  }

  /** Opens a Workspace's row menu and picks `item` (Rename, Change folder, Delete). */
  async workspaceAction(workspaceName: string, item: string): Promise<void> {
    await this.workspaceActions(workspaceName).click();
    await this.page.getByRole("menuitem", { name: item, exact: true }).click();
  }

  /** Drags a Workspace by its row onto the row of the Workspace named `target`. */
  async dragWorkspaceOnto(workspaceName: string, target: string): Promise<void> {
    await this.dragOnto(this.workspace(workspaceName), this.workspace(target));
  }

  /** Drags a Session by its row in the sidebar onto the row of the Session named `target`. */
  async dragSessionOnto(sessionName: string, target: string): Promise<void> {
    await this.dragOnto(this.session(sessionName), this.session(target));
  }

  /**
   * The Open Workspace's Sessions' names, in sidebar order: its Prime, its Worker and the
   * Sessions with the default "session N" names.
   */
  async sessionNames(): Promise<string[]> {
    return accessibleNames(
      this.sidebar.getByRole("button", { name: /^(Prime|Worker|session \d+)$/ }),
    );
  }

  /**
   * On the phone: presses and holds a Session's row in the drawer until it lifts, then
   * drags it with the finger onto the row of the Session named `target`.
   */
  async touchDragSessionOnto(sessionName: string, target: string): Promise<void> {
    const source = this.session(sessionName);
    const from = await source.boundingBox();
    const dest = await this.session(target).boundingBox();
    if (!from || !dest) throw new Error("The rows to drag between are not visible");
    const cdp = await this.page.context().newCDPSession(this.page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const x = from.x + from.width / 2;
    await touch("touchStart", x, from.y + from.height / 2);
    // The row lifts once the press has been held long enough.
    await expect(source).toHaveAttribute("aria-pressed", "true");
    const toY = dest.y + dest.height / 2;
    for (let step = 1; step <= 10; step++) {
      const y = from.y + from.height / 2 + ((toY - from.y - from.height / 2) * step) / 10;
      await touch("touchMove", x, y);
    }
    await touch("touchEnd", x, toY);
    await cdp.detach();
  }

  /** Drags `source` with the mouse onto the middle of `target`. */
  async dragOnto(source: Locator, target: Locator): Promise<void> {
    const from = await source.boundingBox();
    const dest = await target.boundingBox();
    if (!from || !dest) throw new Error("The rows to drag between are not visible");
    const { mouse } = this.page;
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await mouse.down();
    // Pointer-driven drags need intermediate moves to register.
    // Past the few pixels a row needs before a press becomes a drag.
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, {
      steps: 3,
    });
    await mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 10 });
    await mouse.up();
  }

  /** The **+** on a Workspace's row; only the Open Workspace's row has one. */
  newSessionButton(workspaceName: string): Locator {
    return this.sidebar.getByRole("button", {
      name: `New session in ${workspaceName}`,
      exact: true,
    });
  }

  /** The **...** on a Workspace's row; only the Open Workspace's row has one. */
  workspaceActions(workspaceName: string): Locator {
    return this.sidebar.getByRole("button", {
      name: `Actions for ${workspaceName}`,
      exact: true,
    });
  }

  /** Opens the **+** menu on a Workspace's row; it offers New shell and New Claude…. */
  async openNewSessionMenu(workspaceName: string): Promise<void> {
    await this.newSessionButton(workspaceName).click();
  }

  /** The **+** menu's entries, once it is open. */
  get newSessionMenuItems(): Locator {
    return this.page.getByRole("menuitem");
  }

  /** Creates an ordinary shell Session from the **+** menu. */
  async createSession(workspaceName: string): Promise<void> {
    await this.openNewSessionMenu(workspaceName);
    await this.page.getByRole("menuitem", { name: "New shell", exact: true }).click();
    // Until the menu has animated out, it hides the rest of the page from the accessibility tree.
    await expect(this.page.getByRole("menu")).toHaveCount(0);
  }

  /** The New Claude dialog, once **New Claude…** was picked. */
  get claudeDialog(): Locator {
    return this.page.getByRole("dialog", { name: "New Claude Session" });
  }

  /** Opens the New Claude dialog from the **+** menu. */
  async openClaudeDialog(workspaceName: string): Promise<void> {
    await this.openNewSessionMenu(workspaceName);
    await this.page.getByRole("menuitem", { name: "New Claude…", exact: true }).click();
    await expect(this.claudeDialog).toBeVisible();
  }

  /**
   * Fills in the open New Claude dialog. Everything is optional: the name, and each Launch
   * option by the label of the choice ("XHigh", "Off") or, for Focus view, on/off.
   */
  async fillClaudeDialog(
    options: {
      name?: string;
      model?: string;
      effort?: string;
      advisor?: string;
      focusView?: boolean;
    } = {},
  ): Promise<void> {
    if (options.name !== undefined) {
      await this.claudeDialog
        .getByRole("textbox", { name: "Session name" })
        .fill(options.name);
    }
    for (const field of ["Model", "Effort", "Advisor"] as const) {
      const choice = options[field.toLowerCase() as "model" | "effort" | "advisor"];
      if (choice !== undefined) {
        const select = this.claudeDialog.getByRole("combobox", {
          name: field,
          exact: true,
        });
        await select.click();
        await this.page.getByRole("option", { name: choice, exact: true }).click();
        // Until the list has animated out, it hides the rest of the page from the accessibility tree.
        await expect(this.page.getByRole("listbox")).toHaveCount(0);
        await expect(select).toHaveText(choice);
      }
    }
    if (options.focusView !== undefined) {
      await this.claudeDialog
        .getByRole("switch", { name: "Focus view" })
        .setChecked(options.focusView);
    }
  }

  /** Fills in the open New Claude dialog, as `fillClaudeDialog` does, and presses Launch. */
  async launchClaude(
    options: Parameters<AppPage["fillClaudeDialog"]>[0] = {},
  ): Promise<void> {
    await this.fillClaudeDialog(options);
    await this.claudeDialog.getByRole("button", { name: "Launch", exact: true }).click();
  }

  /** Launches a Claude Session in the Workspace from the **+** menu and the dialog. */
  async createClaudeSession(
    workspaceName: string,
    options: Parameters<AppPage["launchClaude"]>[0] = {},
  ): Promise<void> {
    await this.openClaudeDialog(workspaceName);
    await this.launchClaude(options);
  }

  /** The sparkle (or, for the Prime and Worker, crown or hammer) of a Claude Session's row. */
  claudeGlyph(sessionName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${sessionName} is a Claude Session`,
      exact: true,
    });
  }

  /**
   * Creates `count` Sessions ("session 1", "session 2", ...), waiting for each to open in
   * a Pane before creating the next, so a late open can't disturb the view.
   */
  async createSessions(workspaceName: string, count: number): Promise<void> {
    for (let n = 1; n <= count; n++) {
      await this.createSession(workspaceName);
      await expect(this.session(`session ${n}`)).toHaveAttribute("aria-current", "true");
    }
  }

  /**
   * Types a command into `terminal` and waits for its output. The output is built by the
   * shell (the marker never appears in the typed command), so seeing it proves the shell
   * ran the command and not just that the keystrokes were echoed.
   */
  async runMarker(terminal: Locator, marker: string): Promise<void> {
    await this.runCommand(terminal, echoCommand(marker), marker);
  }

  /**
   * Types `command` into `terminal`, presses Enter and waits for `expectedOutput`.
   * Keystrokes typed before the terminal has connected are kept and sent once it opens
   * (see `web/src/terminalConnection.ts`), so a freshly opened terminal needs no retry.
   */
  async runCommand(
    terminal: Locator,
    command: string,
    expectedOutput: string,
  ): Promise<void> {
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    await expect(terminal).toContainText(expectedOutput);
  }
}

/**
 * The names of the buttons `buttons` finds, in order. A sidebar row's button is named
 * explicitly (`aria-label`), since its text also holds a tile's letters or a badge.
 */
async function accessibleNames(buttons: Locator): Promise<string[]> {
  return Promise.all(
    (await buttons.all()).map(
      async (button) => (await button.getAttribute("aria-label")) ?? "",
    ),
  );
}

/** A port nothing is listening on, so a stopped server can come back at the same address. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * The Session named `name` (in the Workspace named `workspaceName`, when given), read from
 * the database whether or not a server runs.
 */
function sessionNamed(
  instance: TestInstance,
  name: string,
  workspaceName?: string,
): SessionRow {
  const store = new Store(instance.config.dataDir);
  try {
    const session = store
      .listWorkspaces()
      .filter(
        (workspace) => workspaceName === undefined || workspace.name === workspaceName,
      )
      .flatMap((workspace) => store.listSessions(workspace.id))
      .find((s) => s.name === name);
    if (!session) throw new Error(`No Session named ${name}`);
    return session;
  } finally {
    store.close();
  }
}

export interface Kbench {
  instance: TestInstance;
  url: string;
  /** Stops the server like a crash or restart would; Sessions keep running in tmux. */
  stopServer(): Promise<void>;
  /** Starts the server again on the same address, data folder and tmux socket. */
  startServer(): Promise<void>;
  /**
   * Rings the terminal bell in the named Session (of the named Workspace, when given), with
   * no browser involved, once no terminal is viewing it (one that just moved to another
   * Session can take a moment to let go). Works while the server is stopped too.
   */
  ringBell(sessionName: string, workspaceName?: string): Promise<void>;
  /**
   * Types a line into the fake Claude Code of the named Claude Session (of the named
   * Workspace, when given), with no browser involved: `think` starts a turn and holds it,
   * and any message is a whole turn.
   */
  tellClaude(sessionName: string, line: string, workspaceName?: string): void;
}

interface Fixtures {
  /** An isolated instance (temp data, unique tmux socket) with a server serving `dist/web`. */
  kbench: Kbench;
  /** The app, already open in the page. */
  app: AppPage;
  /** The app open in a second browser context: another device of the same owner. */
  otherDevice: AppPage;
}

export const test = base.extend<Fixtures>({
  kbench: async ({ context }, use) => {
    const instance = createTestInstance({ allowedLogin: LOGIN, port: await freePort() });
    let server = await instance.start({ webDir: WEB_DIR });
    // Stands in for `tailscale serve`, which adds this header in the real deployment.
    await context.setExtraHTTPHeaders({ "Tailscale-User-Login": LOGIN });
    try {
      await use({
        instance,
        url: server.baseUrl,
        ringBell: async (sessionName, workspaceName) => {
          const session = sessionNamed(instance, sessionName, workspaceName);
          const socket = instance.config.tmuxSocket;
          await pollUntil(() => attachedClientCount(socket, session.id) === 0, {
            description: `no terminal to be viewing ${sessionName}`,
          });
          // A Claude Session runs the stub, which rings when told `bell`.
          typeIntoSession(
            socket,
            session.id,
            session.kind === "claude" ? "bell" : "printf '\\a'",
          );
        },
        tellClaude: (sessionName, line, workspaceName) => {
          const session = sessionNamed(instance, sessionName, workspaceName);
          typeIntoSession(instance.config.tmuxSocket, session.id, line);
        },
        stopServer: () => server.stop(),
        startServer: async () => {
          server = await instance.start({ webDir: WEB_DIR });
        },
      });
    } finally {
      await instance.dispose();
    }
  },
  app: async ({ page, kbench }, use) => {
    await page.goto(kbench.url);
    await use(new AppPage(page, kbench.instance.root));
  },
  otherDevice: async ({ browser, kbench }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "Tailscale-User-Login": LOGIN },
    });
    try {
      const page = await context.newPage();
      await page.goto(kbench.url);
      await use(new AppPage(page, kbench.instance.root));
    } finally {
      await context.close();
    }
  },
});

export { expect };
