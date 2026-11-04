import { createServer } from "node:net";
import { resolve } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { Store } from "../src/server/store.ts";
import { createTestInstance, type TestInstance } from "../test/harness/instance.ts";
import { pollUntil } from "../test/harness/poll.ts";
import { echoCommand } from "../test/harness/terminal.ts";
import { attachedClientCount, typeIntoSession } from "../test/harness/tmux.ts";

const WEB_DIR = resolve("dist/web");
const LOGIN = "owner@example.com";

/**
 * The app as the owner sees it, found by role and accessible name. Later tickets add
 * helpers here as they add UI.
 */
export class AppPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The sidebar listing Workspaces and their Sessions. */
  get sidebar(): Locator {
    return this.page.getByRole("navigation", { name: "Workspaces" });
  }

  /** On the phone: the sidebar's slide-out drawer (hidden until the menu button opens it). */
  get drawer(): Locator {
    return this.sidebar;
  }

  /** On the phone: opens the drawer from the menu button. */
  async openDrawer(): Promise<void> {
    await this.page.getByRole("button", { name: "Menu", exact: true }).tap();
    await expect(this.drawer).toBeVisible();
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

  /** A Session's row in the sidebar. */
  session(name: string): Locator {
    return this.sidebar.getByRole("button", { name, exact: true });
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

  /** One of the (at most two) side-by-side slots in the main view; `n` is 1 or 2. */
  pane(n: 1 | 2): Locator {
    return this.page.getByRole("group", { name: `Pane ${n}`, exact: true });
  }

  /** The terminal showing the named Session, found inside Pane `n`. */
  terminalIn(n: 1 | 2, sessionName: string): Locator {
    return this.pane(n).getByRole("region", {
      name: `Terminal ${sessionName}`,
      exact: true,
    });
  }

  /** The toggle between one and two Panes. */
  get panesToggle(): Locator {
    return this.page.getByRole("button", { name: "Two panes", exact: true });
  }

  /** Switches the main view to two Panes if it is not already. */
  async showTwoPanes(): Promise<void> {
    if ((await this.panesToggle.getAttribute("aria-pressed")) !== "true") {
      await this.panesToggle.click();
    }
    await expect(this.pane(2)).toBeVisible();
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

  /** Opens a Session's row menu and picks "Open in other pane". */
  async openInOtherPane(sessionName: string): Promise<void> {
    await this.sessionMenu(sessionName, "Open in other pane");
  }

  /** The running/Stopped indicator beside a Session in the sidebar. */
  sessionStatus(name: string, status: "running" | "stopped"): Locator {
    return this.sidebar.getByRole("img", { name: `${name} ${status}`, exact: true });
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
    await this.page.getByRole("textbox", { name: "Folder path" }).fill(folder);
    if (options.name !== undefined) {
      await this.page.getByRole("textbox", { name: "Name" }).fill(options.name);
    }
    await this.page.getByRole("button", { name: "Create Workspace" }).click();
  }

  /**
   * Creates a Workspace by browsing the Host's folders from the picker's root: opens each
   * named folder in turn, then creates a Workspace on the last one.
   */
  async createWorkspaceByBrowsing(...path: string[]): Promise<void> {
    await this.page.getByRole("button", { name: "New Workspace" }).click();
    await this.page.getByRole("button", { name: "Browse folders" }).click();
    const browser = this.page.getByRole("region", { name: "Folder browser" });
    for (const folder of path) {
      await browser.getByRole("button", { name: folder, exact: true }).click();
    }
    await this.page.getByRole("button", { name: "Create Workspace" }).click();
  }

  /** A Workspace's heading in the sidebar. */
  workspace(name: string): Locator {
    return this.sidebar.getByRole("heading", { name, exact: true });
  }

  /** The Bell badge on a Session's row; present only while its Bell is raised. */
  bellBadge(sessionName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${sessionName} rang the bell`,
      exact: true,
    });
  }

  /** The hint on a Workspace row saying some Session in it rang the bell. */
  workspaceBellHint(workspaceName: string): Locator {
    return this.sidebar.getByRole("img", {
      name: `${workspaceName} has a session that rang the bell`,
      exact: true,
    });
  }

  /** Collapses a Workspace's Sessions out of view. */
  async collapseWorkspace(workspaceName: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `Collapse ${workspaceName}`, exact: true })
      .click();
  }

  /** Shows a collapsed Workspace's Sessions again. */
  async expandWorkspace(workspaceName: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
      .click();
  }

  /** The notice on a Workspace that is Missing; absent when its folder exists. */
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
    return this.sidebar.getByRole("heading").allTextContents();
  }

  /** Opens a Workspace's row menu and picks `item` (Rename, Change folder, Delete). */
  async workspaceAction(workspaceName: string, item: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `Actions for ${workspaceName}`, exact: true })
      .click();
    await this.page.getByRole("menuitem", { name: item, exact: true }).click();
  }

  /** Drags a Workspace by its handle onto the row of the Workspace named `target`. */
  async dragWorkspaceOnto(workspaceName: string, target: string): Promise<void> {
    const handle = this.sidebar.getByRole("button", {
      name: `Reorder ${workspaceName}`,
      exact: true,
    });
    const from = await handle.boundingBox();
    const dest = await this.workspace(target).boundingBox();
    if (!from || !dest) throw new Error("Workspace rows are not visible");
    const { mouse } = this.page;
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await mouse.down();
    // Pointer-driven drags need intermediate moves to register.
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 5, { steps: 3 });
    await mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 10 });
    await mouse.up();
  }

  async createSession(workspaceName: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `New session in ${workspaceName}` })
      .click();
  }

  /**
   * Creates `count` Sessions ("session 1", "session 2", ...), waiting for each to open in
   * the Focused Pane before creating the next, so a late open can't disturb the layout.
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
   * Keystrokes typed before the terminal has connected are dropped, so a freshly opened
   * terminal is retried.
   */
  async runCommand(
    terminal: Locator,
    command: string,
    expectedOutput: string,
  ): Promise<void> {
    await expect(async () => {
      await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
      await this.page.keyboard.type(command);
      await this.page.keyboard.press("Enter");
      await expect(terminal).toContainText(expectedOutput, { timeout: 2_000 });
    }).toPass();
  }
}

/** A port nothing is listening on, so a stopped server can come back at the same address. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** The id of the Session named `name`, read from the database whether or not a server runs. */
function sessionIdNamed(instance: TestInstance, name: string): string {
  const store = new Store(instance.config.dataDir);
  try {
    const session = store
      .listWorkspaces()
      .flatMap((workspace) => store.listSessions(workspace.id))
      .find((s) => s.name === name);
    if (!session) throw new Error(`No Session named ${name}`);
    return session.id;
  } finally {
    store.close();
  }
}

interface Kbench {
  instance: TestInstance;
  url: string;
  /** Stops the server like a crash or restart would; Sessions keep running in tmux. */
  stopServer(): Promise<void>;
  /** Starts the server again on the same address, data folder and tmux socket. */
  startServer(): Promise<void>;
  /**
   * Rings the terminal bell in the named Session's shell, with no browser involved, once no
   * terminal is viewing it (one that just moved to another Session can take a moment to let
   * go). Works while the server is stopped too.
   */
  ringBell(sessionName: string): Promise<void>;
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
        ringBell: async (sessionName) => {
          const id = sessionIdNamed(instance, sessionName);
          const socket = instance.config.tmuxSocket;
          await pollUntil(() => attachedClientCount(socket, id) === 0, {
            description: `no terminal to be viewing ${sessionName}`,
          });
          typeIntoSession(socket, id, "printf '\\a'");
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
    await use(new AppPage(page));
  },
  otherDevice: async ({ browser, kbench }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "Tailscale-User-Login": LOGIN },
    });
    try {
      const page = await context.newPage();
      await page.goto(kbench.url);
      await use(new AppPage(page));
    } finally {
      await context.close();
    }
  },
});

export { expect };
