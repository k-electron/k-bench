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

  /** Opens a Session's row menu and picks "Open in other pane". */
  async openInOtherPane(sessionName: string): Promise<void> {
    await this.sidebar
      .getByRole("button", { name: `Menu for ${sessionName}`, exact: true })
      .click();
    await this.page.getByRole("menuitem", { name: "Open in other pane" }).click();
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

  async createWorkspace(folder: string): Promise<void> {
    await this.page.getByRole("button", { name: "New Workspace" }).click();
    await this.page.getByRole("textbox", { name: "Folder path" }).fill(folder);
    await this.page.getByRole("button", { name: "Create Workspace" }).click();
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
});

export { expect };
