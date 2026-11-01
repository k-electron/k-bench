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

  async createSession(workspaceName: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `New session in ${workspaceName}` })
      .click();
  }

  /**
   * Types a command into `terminal` and waits for its output. The output is built by the
   * shell (the marker never appears in the typed command), so seeing it proves the shell
   * ran the command and not just that the keystrokes were echoed.
   */
  async runMarker(terminal: Locator, marker: string): Promise<void> {
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await this.page.keyboard.type(echoCommand(marker));
    await this.page.keyboard.press("Enter");
    await expect(terminal).toContainText(marker);
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
