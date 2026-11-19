// The one scenario with a terminal in it: a conversation that moves from an SDK session to a
// Claude TUI (`claude --resume`, in a tmux server of the check's own) and back, with a turn, the
// permission-mode cycle, a denial with a reply, `/rewind` and `/compact` in the terminal.
//
// Driving the TUI by keystrokes is the fragile part, and what its menus look like cannot be
// confirmed without the real `claude`, so every wait is bounded and polls the pane for text,
// and a menu that does not appear is recorded as "not reached" (the checks then say NOT
// PROVOKED), never waited on for ever. Every decision is made on the screen as it is now (no
// scrollback, where old dialogs and labels linger), and on text only a menu has: the command
// typed to open it, which is echoed on the screen, never counts. A permission dialog is
// accepted only when the text after its own question names the file the check asked about.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { FakeStep } from "../../test/harness/fake-claude.ts";
import { BudgetExhausted, blockedTools, claudeEnvironment } from "./rails.ts";
import {
  afterLast,
  cursorLine,
  footerOf,
  menuShown,
  permissionKey,
  TRUST_QUESTION,
  trustKey,
} from "./screen.ts";
import { RunAborted } from "./session.ts";
import { shellQuote, Tmux, until } from "./tmux.ts";
import type { Ctx, Scenario } from "./types.ts";

export const TUI_PROMPT =
  "Use the Write tool to overwrite story.txt with the single line: terminal one. Then reply with the single word DONE.";
export const DENY_FEEDBACK = "use exactly the content I gave you";
/** Starts the web's first prompt, so that its line in the `/rewind` menu is found by it. */
export const WEB_MARKER = "WEBONE";

// Ready for a prompt: the input line (`❯`) and a footer naming the permission mode (`⏸ manual
// mode on` in the default mode, as the real TUI draws it; older builds said `? for shortcuts`).
// The trust question has `❯` too but no such footer.
const IDLE =
  /❯[\s\S]*(?:manual mode on|accept edits on|plan mode on|auto mode on|bypass permissions on|\? for shortcuts)/i;
const WORKING = /esc to interrupt/i;
const MODE_LABEL =
  /(manual mode on|accept edits on|plan mode on|auto mode on|auto-accept edits on|bypass permissions on|don't ask on)/i;

const readTrim = (path: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Moves a dialog's cursor, by the option's text, to the option `want` names. For `allow` it
 * also presses Enter on it; for `reply` it stops there (the reply is typed into that option).
 * Bounded; false when the option was not reached.
 */
async function choose(tmux: Tmux, want: "allow" | "reply"): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    const key = permissionKey(tmux.capture(), want);
    if (key === "type") return true;
    if (key === "Enter") {
      tmux.keys("Enter");
      return true;
    }
    if (key === "none") return false;
    tmux.keys("Down");
    await sleep(300);
  }
  return false;
}

function newTmux(ctx: Ctx): Tmux {
  const { run, extras } = ctx;
  const tmux = new Tmux(
    run.id,
    claudeEnvironment(process.env, {
      ...(run.fake ? { configDir: run.configDir } : {}),
      advisorOff: true,
    }),
    run.abort.signal,
  );
  extras.tmux = tmux;
  return tmux;
}

async function steer(tmux: Tmux, ctx: Ctx, sid: string): Promise<void> {
  const { run } = ctx;
  const command = run.fake
    ? `${shellQuote(run.claude)} --resume ${sid}`
    : [
        shellQuote(run.claude),
        "--resume",
        sid,
        "--model",
        "haiku",
        "--effort",
        "low",
        "--permission-mode",
        "default",
        "--strict-mcp-config",
        "--settings",
        shellQuote(JSON.stringify({ disableClaudeAiConnectors: true })),
        "--disallowedTools",
        shellQuote(blockedTools({ fromRules: run.settings.denyToo }).join(",")),
      ].join(" ");
  const pid = tmux.start(command, run.folder);
  if (pid !== undefined) run.pids.add(pid);
  // Ready: the stub says so; the real one draws its prompt (after a trust question, if asked).
  const ready = run.fake ? /claude-stub ready/ : IDLE;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const pane = tmux.capture();
    if (ready.test(pane)) return;
    // The folder-trust question: its default is "No, exit". Move to "Yes, I trust this folder"
    // and press Enter only once the cursor is on it (`--fake-break trust-enter` presses Enter
    // blindly, as the first real run did, to show the terminal then quits).
    if (ctx.extras.breakMode === "trust-enter" && TRUST_QUESTION.test(pane)) {
      tmux.keys("Enter");
    } else {
      const key = trustKey(pane);
      if (key !== "none") tmux.keys(key);
    }
    if (!tmux.alive() || run.abort.signal.aborted) break;
    await sleep(500);
  }
  throw new Error("the terminal did not come up");
}

/** Ends a terminal visit: `/exit` (the stub: `exit 0`), then whatever is left is killed. */
async function leave(tmux: Tmux, fake: boolean): Promise<void> {
  if (tmux.alive()) {
    tmux.type(fake ? "exit 0" : "/exit");
    tmux.keys("Enter");
    await until(() => !tmux.alive(), 15_000);
  }
  tmux.kill();
}

/** What a terminal visit saw, noted for the checks (labels, never the pane's text). */
interface Visit {
  reached: Record<string, boolean>;
  details: Record<string, string>;
}

const newVisit = (): Visit => ({ reached: {}, details: {} });

/** Visit 1: one turn that asks for a permission (denied once with a reply, then allowed), then `/rewind`. */
async function visitOne(ctx: Ctx, sid: string, story: string): Promise<Visit> {
  const { run } = ctx;
  const visit = newVisit();
  const tmux = newTmux(ctx);
  try {
    await steer(tmux, ctx, sid);
    visit.reached.up = true;
    run.budget.spendUnobserved("terminal");
    tmux.type(TUI_PROMPT);
    tmux.keys("Enter");
    if (run.fake) {
      visit.reached.turn = Boolean(await tmux.waitFor(/claude-stub heard:/, 15_000));
      return visit;
    }
    // The turn: a permission dialog for story.txt. The first is denied with a reply, the next allowed.
    let denied = false;
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && readTrim(story) !== "terminal one") {
      if (run.abort.signal.aborted) break;
      const pane = tmux.capture();
      if (/Do you want to/i.test(pane)) {
        if (!/story\.txt/.test(afterLast(pane, /Do you want to/i))) {
          // Not the file asked about: refuse, and stop trying.
          tmux.keys("Escape");
          visit.details.dialog = "a permission dialog for something else was refused";
          break;
        }
        visit.reached.dialog = true;
        if (!denied) {
          denied = true;
          // The reply makes Claude try again: that is a second model call, so a second turn.
          run.budget.spendUnobserved("terminal");
          // Move the cursor to "No, and tell Claude what to do differently" and type the reply.
          if (await choose(tmux, "reply")) {
            tmux.type(DENY_FEEDBACK);
            await sleep(500);
            tmux.keys("Enter");
            visit.reached.deniedWithReply = true;
          } else {
            tmux.keys("Escape");
          }
        } else if (!(await choose(tmux, "allow"))) {
          // The plain "Yes" could not be found on the screen: nothing is pressed blindly.
          tmux.keys("Escape");
          visit.details.dialog = "the Yes option of a permission dialog was not found";
          break;
        }
        // The dialog is answered: let the screen move on before it is looked at again.
        await sleep(1500);
      }
      await sleep(1000);
    }
    visit.reached.turn = readTrim(story) === "terminal one";
    await until(() => IDLE.test(tmux.capture()) && !WORKING.test(tmux.capture()), 60_000);

    // /rewind: the web's first prompt (found by its marker), then "Restore code".
    tmux.type("/rewind");
    tmux.keys("Enter");
    const opened = await until(
      () => menuShown(tmux.capture(), /Rewind|Restore|checkpoint/),
      15_000,
    );
    visit.reached.rewindMenu = opened !== undefined;
    if (opened) {
      for (let i = 0; i < 12; i++) {
        if (cursorLine(tmux.capture()).includes(WEB_MARKER)) break;
        tmux.keys("Up");
        await sleep(300);
      }
      visit.reached.rewindPicked = cursorLine(tmux.capture()).includes(WEB_MARKER);
      if (visit.reached.rewindPicked) {
        tmux.keys("Enter");
        const options = await tmux.waitFor(/Restore code/, 15_000);
        if (options) {
          for (let i = 0; i < 5; i++) {
            const line = cursorLine(tmux.capture());
            if (/Restore code/.test(line) && !/conversation/i.test(line)) break;
            tmux.keys("Down");
            await sleep(300);
          }
          const line = cursorLine(tmux.capture());
          if (/Restore code/.test(line) && !/conversation/i.test(line)) {
            tmux.keys("Enter");
            visit.reached.rewindAttempted = true;
            visit.reached.rewindRestored = Boolean(
              await until(() => readTrim(story) === "original", 20_000),
            );
          }
        }
      }
      tmux.keys("Escape");
    }
    return visit;
  } finally {
    await leave(tmux, run.fake);
  }
}

/** Visit 2: the permission-mode cycle (back to where it started), then `/compact`. */
async function visitTwo(ctx: Ctx, sid: string): Promise<Visit & { cycle: string[] }> {
  const { run } = ctx;
  const visit = { ...newVisit(), cycle: [] as string[] };
  const tmux = newTmux(ctx);
  try {
    await steer(tmux, ctx, sid);
    visit.reached.up = true;
    if (!run.fake) {
      // Shift+Tab until the footer names the mode it started in again: the labels seen on the
      // way are the cycle (the default is labelled too: `manual mode on`).
      const start = MODE_LABEL.exec(footerOf(tmux.capture()))?.[1]?.toLowerCase();
      if (start !== undefined) {
        visit.cycle.push(start);
        for (let i = 0; i < 8; i++) {
          tmux.keys("BTab");
          await sleep(700);
          const label = MODE_LABEL.exec(footerOf(tmux.capture()))?.[1]?.toLowerCase();
          if (label === undefined) continue;
          if (label === start) {
            visit.reached.cycle = true;
            break;
          }
          visit.cycle.push(label);
        }
      }
    }
    run.budget.spendUnobserved("terminal");
    tmux.type("/compact");
    tmux.keys("Enter");
    visit.reached.compacted = Boolean(
      await tmux.waitFor(run.fake ? /claude-stub compacted/ : /compact(ed|ion)/i, 90_000),
    );
    return visit;
  } finally {
    await leave(tmux, run.fake);
  }
}

export const terminalScenario: Scenario = {
  name: "terminal",
  budget: 7,
  async run(ctx) {
    const { run, cap } = ctx;
    const story = join(run.folder, "story.txt");
    writeFileSync(story, "original\n");
    const first = randomUUID();
    const second = randomUUID();
    cap.notes.ids = { first, second };

    // The web: two turns, the first editing a file with checkpointing on.
    const web = ctx.open({});
    const fakeSteps: FakeStep[] = [
      {
        tool: { name: "Write", input: { file_path: story, content: "web one\n" } },
        ask: true,
      },
      { text: "DONE" },
    ];
    run.fakeClaude?.script(fakeSteps);
    await web.turn(
      `${WEB_MARKER}: use the Write tool to overwrite ${story} with the single line: web one. Then reply DONE.`,
      { uuid: first },
    );
    await web.turn("Remember the codeword ALBATROSS for later. Reply only OK.", {
      uuid: second,
    });
    const sid = web.init?.session_id;
    if (typeof sid !== "string")
      throw new Error("no conversation ID from the web session");
    cap.notes.sid = sid;
    await web.close();

    // The terminal, then back to the web: the same conversation.
    cap.notes.visitOne = await attempt(cap, "visitOne", () => visitOne(ctx, sid, story));
    cap.notes.storyAfterTerminal = readTrim(story);
    const back = ctx.open({ resume: sid });
    cap.notes.backFrom = back.msgs.length;
    await back.turn(
      "What codeword did I ask you to remember, and what line did I last ask you to write in story.txt? Answer from the conversation, without using any tool, as CODEWORD/LINE only.",
    );
    cap.notes.backInit = back.init?.session_id;
    await back.close();
    cap.notes.savedAfterVisitOne = await saved(ctx, sid);
    assertHaiku(ctx, cap.notes.savedAfterVisitOne as unknown[]);

    // The terminal again: the mode cycle and `/compact`.
    cap.notes.visitTwo = await attempt(cap, "visitTwo", () => visitTwo(ctx, sid));
    cap.notes.savedAfterCompact = await saved(ctx, sid);
    assertHaiku(ctx, cap.notes.savedAfterCompact as unknown[]);
  },
};

/** A terminal visit that fails is noted (its reason, short) and the scenario carries on. */
async function attempt<T>(
  cap: Ctx["cap"],
  label: string,
  visit: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await visit();
  } catch (error) {
    if (error instanceof RunAborted || error instanceof BudgetExhausted) throw error;
    cap.notes[`${label}Error`] =
      error instanceof Error ? error.message.slice(0, 160) : "failed";
    return undefined;
  }
}

/**
 * A terminal turn sends no `init`, so what model it ran on is read from the conversation it saved:
 * every assistant message names its model. Not Haiku ends the whole run, as an `init` would.
 */
function assertHaiku(ctx: Ctx, messages: unknown[]): void {
  if (ctx.run.fake) return;
  for (const message of messages) {
    const inner = (message as { type?: string; message?: { model?: unknown } }).message;
    if (
      (message as { type?: string }).type !== "assistant" ||
      typeof inner?.model !== "string"
    )
      continue;
    if (!/haiku|<synthetic>/i.test(inner.model)) {
      ctx.run.fail(
        `a turn in the terminal ran on the model "${inner.model.slice(0, 80)}", not Haiku`,
      );
      return;
    }
  }
}

async function saved(ctx: Ctx, sid: string): Promise<unknown[]> {
  try {
    return await getSessionMessages(sid, {
      dir: ctx.run.folder,
      includeSystemMessages: true,
    });
  } catch {
    return [];
  }
}
