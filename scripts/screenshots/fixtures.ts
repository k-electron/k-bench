import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import { type AppPage, test as base } from "../../e2e/harness.ts";
import { demoShellEnv, HOME_ENV } from "./demo-home.ts";
import { IMAGES_DIR, type ImageName } from "./images.ts";
import { describeFindings, findPrivate } from "./privacy.ts";

export { expect };

const PLAYER = fileURLToPath(new URL("./play.ts", import.meta.url));
const LOGIN = "owner@example.com";

interface Demo {
  /** The fake home folder. */
  home: string;
  /** Creates a Workspace on `~/code/<name>` with these Sessions; the sidebar updates itself. */
  workspace(name: string, sessions: string[]): Promise<void>;
  /**
   * Makes a command on the fake PATH that plays `recording` back in the terminal it runs
   * in, so what is typed into the Session is short and names no real path.
   */
  playerCommand(recording: string): { command: string; done: string };
  /** Plays the recording in the terminal and waits until it has finished drawing. */
  play(app: AppPage, terminal: Locator, recording: string): Promise<void>;
  /** Fails if the page's text has anything of the real machine in it. */
  assertNothingPrivate(): Promise<void>;
  /** Saves a screenshot into docs/images, after checking nothing private is on the page. */
  shoot(name: ImageName): Promise<void>;
}

export const test = base.extend<{ demo: Demo }>({
  // Start the instance's tmux server with the fake environment before the first Session
  // exists. A tmux server hands its own environment to every shell it starts, and the
  // k-bench server, which runs with the real one, would otherwise start it.
  kbench: async ({ kbench }, use) => {
    const home = process.env[HOME_ENV];
    if (!home) throw new Error("Run this with `pnpm screenshots`");
    const socket = kbench.instance.config.tmuxSocket;
    if (!socket.startsWith("kb-test-")) throw new Error(`refusing tmux socket ${socket}`);
    execFileSync(
      findOnPath("tmux"),
      [
        "-L",
        socket,
        "-f",
        "/dev/null",
        "start-server",
        ";",
        "set",
        "-g",
        "exit-empty",
        "off",
      ],
      { env: demoShellEnv(home), stdio: "ignore" },
    );
    await use(kbench);
  },
  demo: async ({ kbench, page }, use) => {
    const home = process.env[HOME_ENV] ?? "";
    const post = (path: string, body: unknown) =>
      fetch(new URL(path, kbench.url), {
        method: "POST",
        headers: { "content-type": "application/json", "Tailscale-User-Login": LOGIN },
        body: JSON.stringify(body),
      });
    let players = 0;

    const demo: Demo = {
      home,
      workspace: async (name, sessions) => {
        const created = await post("/api/workspaces", {
          folder: join(home, "code", name),
        });
        const { id } = (await created.json()) as { id: string };
        for (const session of sessions) {
          await post(`/api/workspaces/${id}/sessions`, { name: session });
        }
      },
      playerCommand: (recording) => {
        const command = `play-${++players}`;
        const done = join(home, `${command}.done`);
        writeFileSync(
          join(home, "bin", command),
          `#!/bin/sh\nK_BENCH_PLAY_DONE='${done}' exec '${process.execPath}' '${PLAYER}' '${recording}'\n`,
          { mode: 0o755 },
        );
        return { command, done };
      },
      play: async (app, terminal, recording) => {
        const { command, done } = demo.playerCommand(recording);
        // Keystrokes typed before the shell is up are dropped, so wait for it first.
        await app.runMarker(terminal, "shellready");
        await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
        await page.keyboard.type(command);
        await page.keyboard.press("Enter");
        await expect.poll(() => existsSync(done)).toBe(true);
        await settled(terminal);
      },
      assertNothingPrivate: async () => {
        const text = `${await page.title()}\n${await page.locator("body").textContent()}`;
        const findings = findPrivate(text);
        expect(findings, describeFindings(findings)).toEqual([]);
      },
      shoot: async (name) => {
        await demo.assertNothingPrivate();
        mkdirSync(IMAGES_DIR, { recursive: true });
        await page.screenshot({ path: join(IMAGES_DIR, name) });
      },
    };
    await use(demo);
  },
});

/** The full path of a program found on the real PATH (the shells' PATH is a fake one). */
function findOnPath(program: string): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const path = join(dir, program);
    if (existsSync(path)) return path;
  }
  throw new Error(`${program} is not installed`);
}

/** Waits until a terminal's text has stopped changing. */
export async function settled(terminal: Locator): Promise<void> {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const text = await terminal.textContent();
        const same = text === previous;
        previous = text;
        return same;
      },
      { intervals: [400] },
    )
    .toBe(true);
}

/**
 * Sizes the browser window so `terminal` is exactly `cols` x `rows` characters: a recording
 * of a full-screen program only draws right at the size it was made for.
 */
export async function fitTerminal(
  app: AppPage,
  page: Page,
  terminal: Locator,
  size: { cols: number; rows: number },
): Promise<void> {
  // A window resize reaches the shell some moments later, in steps, so a size is only
  // believed once it has been measured twice with a pause between.
  const stableSize = async () => {
    for (let i = 0; i < 10; i++) {
      const first = await app.terminalSize(terminal);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const second = await app.terminalSize(terminal);
      if (first.cols === second.cols && first.rows === second.rows) return second;
    }
    throw new Error("The terminal's size keeps changing");
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const now = await stableSize();
    if (now.cols === size.cols && now.rows === size.rows) return;
    const box = await terminal.boundingBox();
    const view = page.viewportSize();
    if (!box || !view) throw new Error("The terminal is not visible");
    const cellWidth = box.width / now.cols;
    const cellHeight = box.height / now.rows;
    const step = (diff: number, cell: number) =>
      Math.sign(diff) * Math.ceil(Math.abs(diff) * cell);
    await page.setViewportSize({
      width: view.width + step(size.cols - now.cols, cellWidth),
      height: view.height + step(size.rows - now.rows, cellHeight),
    });
  }
  throw new Error(`Could not size the terminal to ${size.cols}x${size.rows}`);
}
