import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { permissionKey, trustKey } from "../scripts/live-check/screen.ts";
import { FakeClaude, installFakeClaude } from "./harness/fake-claude.ts";
import { pollUntil } from "./harness/poll.ts";
import { testSocketName, tmuxSocketDir } from "./harness/socket-leaks.ts";

// How the live check (docs/internals/live-check.md) drives a Claude TUI: it never presses Enter
// on a dialog's default. The first real run pressed Enter on the folder-trust question, whose
// default is "No, exit", and the terminal quit.

const temp: string[] = [];
afterEach(() => {
  for (const folder of temp.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("driving a terminal's dialogs", () => {
  it("presses Enter on the folder-trust question only once the cursor is on Yes, and answers a permission dialog by the option's text", () => {
    const question = (cursor: 1 | 2) =>
      `Do you trust the files in this folder?\n${cursor === 1 ? "❯" : " "} 1. No, exit\n${cursor === 2 ? "❯" : " "} 2. Yes, I trust this folder\n`;
    expect(trustKey(question(1))).toBe("Down");
    expect(trustKey(question(2))).toBe("Enter");
    expect(trustKey("some other screen\n❯ 1. No, exit")).toBe("none");
    expect(trustKey("Do you trust the files in this folder?\n")).toBe("none");

    const dialog = (cursor: number) =>
      [
        "Yes",
        "Yes, allow all edits during this session",
        "No, and tell Claude what to do differently",
      ]
        .map((text, i) => `${i === cursor ? "❯" : " "} ${i + 1}. ${text}`)
        .join("\n");
    expect(permissionKey(dialog(0), "allow")).toBe("Enter");
    expect(permissionKey(dialog(1), "allow")).toBe("Down");
    expect(permissionKey(dialog(2), "allow")).toBe("Down");
    expect(permissionKey(dialog(2), "reply")).toBe("type");
    expect(permissionKey(dialog(0), "reply")).toBe("Down");
  });

  it("the terminal stand-in quits on Enter at the trust question's default, and carries on after Down and Enter", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kb-livecheck-trust-")));
    temp.push(root);
    const program = installFakeClaude(root);
    new FakeClaude(root).requireTrust();
    const socket = testSocketName();
    const tmux = (...args: string[]) =>
      execFileSync("tmux", ["-L", socket, "-f", "/dev/null", ...args], {
        encoding: "utf8",
      });
    const screen = (name: string) => tmux("capture-pane", "-p", "-t", name);
    try {
      for (const name of ["blind", "careful"]) {
        tmux(
          "new-session",
          "-d",
          "-s",
          name,
          "-x",
          "120",
          "-y",
          "30",
          `${program} --session-id ${randomUUID()}; echo stub-exit-$?; sleep 20`,
        );
        await pollUntil(() => /Do you trust/.test(screen(name)), {
          description: "the trust question",
        });
      }
      // Enter on the default: the terminal quits.
      tmux("send-keys", "-t", "blind", "Enter");
      await pollUntil(() => /stub-exit-1/.test(screen("blind")), {
        description: "the refusal",
      });
      // Down, and Enter once the cursor is on Yes: it carries on.
      tmux("send-keys", "-t", "careful", "Down");
      await pollUntil(() => /❯ 2\. Yes/.test(screen("careful")), {
        description: "the cursor on Yes",
      });
      tmux("send-keys", "-t", "careful", "Enter");
      await pollUntil(() => /claude-stub ready/.test(screen("careful")), {
        description: "the terminal ready",
      });
    } finally {
      try {
        tmux("kill-server");
      } catch {
        // Already gone.
      }
      rmSync(join(tmuxSocketDir(), socket), { force: true });
    }
  });
});
