import { resolve } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { createTestInstance, type TestInstance } from "../test/harness/instance.ts";
import { echoCommand } from "../test/harness/terminal.ts";

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
   */
  async terminalSize(terminal: Locator): Promise<{ cols: number; rows: number }> {
    const tag = `size${++this.sizeProbes}`;
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await this.page.keyboard.type(`echo "${tag}=$(tput cols)x$(tput lines)"`);
    await this.page.keyboard.press("Enter");
    await expect(terminal).toContainText(new RegExp(`${tag}=\\d+x\\d+`));
    const text = (await terminal.textContent()) ?? "";
    const [, cols, rows] = new RegExp(`${tag}=(\\d+)x(\\d+)`).exec(text) ?? [];
    return { cols: Number(cols), rows: Number(rows) };
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
   * ran the command and not just that the keystrokes were echoed. Keystrokes typed before
   * the terminal has connected are dropped, so a freshly opened terminal is retried.
   */
  async runMarker(terminal: Locator, marker: string): Promise<void> {
    await expect(async () => {
      await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
      await this.page.keyboard.type(echoCommand(marker));
      await this.page.keyboard.press("Enter");
      await expect(terminal).toContainText(marker, { timeout: 2_000 });
    }).toPass();
  }
}

interface Fixtures {
  /** An isolated instance (temp data, unique tmux socket) with a server serving `dist/web`. */
  kbench: { instance: TestInstance; url: string };
  /** The app, already open in the page. */
  app: AppPage;
  /** The app open in a second browser context: another device of the same owner. */
  otherDevice: AppPage;
}

export const test = base.extend<Fixtures>({
  kbench: async ({ context }, use) => {
    const instance = createTestInstance({ allowedLogin: LOGIN });
    const server = await instance.start({ webDir: WEB_DIR });
    // Stands in for `tailscale serve`, which adds this header in the real deployment.
    await context.setExtraHTTPHeaders({ "Tailscale-User-Login": LOGIN });
    try {
      await use({ instance, url: server.baseUrl });
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
