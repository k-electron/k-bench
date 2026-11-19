// The one scenario with a terminal in it: a conversation that moves from an SDK session to a
// Claude TUI (`claude --resume`, in a tmux server of the check's own) and back, with a turn, the
// permission-mode cycle, a denial with a reply, `/rewind` and `/compact` in the terminal.
//
// Driving the TUI by keystrokes is the fragile part, and what its menus look like cannot be
// confirmed without the real `claude`, so every wait is bounded and polls the pane for text,
// and a menu that does not appear is recorded as "not reached" (the checks then say NOT
// PROVOKED), never waited on for ever. A permission dialog is accepted only when it names the
// file the check asked about.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { FakeStep } from "../../test/harness/fake-claude.ts";
import { BudgetExhausted, blockedTools, claudeEnvironment } from "./rails.ts";
import { RunAborted } from "./session.ts";
import { shellQuote, Tmux, until } from "./tmux.ts";
import type { Ctx, Scenario } from "./types.ts";

export const TUI_PROMPT =
  "Use the Write tool to overwrite story.txt with the single line: terminal one. Then reply with the single word DONE.";
export const DENY_FEEDBACK = "use exactly the content I gave you";

const IDLE = /\? for shortcuts/;
const WORKING = /esc to interrupt/i;
const TRUST = /trust the files|Do you trust|Yes, proceed|Yes, I trust/i;

const readTrim = (path: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

/** The line the TUI's menu cursor (`❯`) is on. */
const cursorLine = (pane: string) =>
  pane.split("\n").find((line) => /^\s*[❯›>]\s/.test(line)) ?? "";

async function steer(
  tmux: Tmux,
  ctx: Ctx,
  options: { fake: boolean; sid: string },
): Promise<void> {
  const { run } = ctx;
  const command = run.fake
    ? `${shellQuote(run.claude)} --resume ${options.sid}`
    : [
        shellQuote(run.claude),
        "--resume",
        options.sid,
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
    if (!run.fake && TRUST.test(pane)) tmux.keys("Enter");
    if (!tmux.alive() || run.abort.signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  const { run, extras } = ctx;
  const visit = newVisit();
  const tmux = new Tmux(
    run.id,
    claudeEnvironment(process.env, { configDir: run.configDir, advisorOff: true }),
    run.abort.signal,
  );
  extras.tmux = tmux;
  try {
    await steer(tmux, ctx, { fake: run.fake, sid });
    visit.reached.up = true;
    run.budget.spendUnobserved("terminal");
    tmux.type(run.fake ? TUI_PROMPT : TUI_PROMPT);
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
        if (!/story\.txt/.test(pane)) {
          // Not the file asked about: refuse, and stop trying.
          tmux.keys("Escape");
          visit.details.dialog = "a permission dialog for something else was refused";
          break;
        }
        visit.reached.dialog = true;
        if (!denied) {
          denied = true;
          // Move the cursor to the "No, and tell Claude what to do differently" option and type the reply.
          for (
            let i = 0;
            i < 4 && !/tell Claude/i.test(cursorLine(tmux.capture()));
            i++
          ) {
            tmux.keys("Down");
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          if (/tell Claude/i.test(cursorLine(tmux.capture()))) {
            tmux.type(DENY_FEEDBACK);
            await new Promise((resolve) => setTimeout(resolve, 500));
            tmux.keys("Enter");
            visit.reached.deniedWithReply = true;
          } else {
            tmux.keys("Escape");
          }
        } else {
          tmux.keys("Enter");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    visit.reached.turn = readTrim(story) === "terminal one";
    await until(() => IDLE.test(tmux.capture()) && !WORKING.test(tmux.capture()), 60_000);

    // /rewind: the first prompt of the web, then "Restore code".
    tmux.type("/rewind");
    tmux.keys("Enter");
    const menu = await tmux.waitFor(/Rewind|Restore/i, 15_000);
    visit.reached.rewindMenu = menu !== undefined;
    if (menu) {
      for (let i = 0; i < 12; i++) {
        if (/web one/.test(cursorLine(tmux.capture()))) break;
        tmux.keys("Up");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      visit.reached.rewindPicked = /web one/.test(cursorLine(tmux.capture()));
      if (visit.reached.rewindPicked) {
        tmux.keys("Enter");
        const options = await tmux.waitFor(/Restore code/i, 15_000);
        if (options) {
          for (let i = 0; i < 5; i++) {
            const line = cursorLine(tmux.capture());
            if (/Restore code/i.test(line) && !/conversation/i.test(line)) break;
            tmux.keys("Down");
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          if (/Restore code/i.test(cursorLine(tmux.capture()))) {
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

/** Visit 2: the permission-mode cycle, then `/compact`. */
async function visitTwo(ctx: Ctx, sid: string): Promise<Visit & { cycle: string[] }> {
  const { run, extras } = ctx;
  const visit = { ...newVisit(), cycle: [] as string[] };
  const tmux = new Tmux(
    run.id,
    claudeEnvironment(process.env, { configDir: run.configDir, advisorOff: true }),
    run.abort.signal,
  );
  extras.tmux = tmux;
  try {
    await steer(tmux, ctx, { fake: run.fake, sid });
    visit.reached.up = true;
    if (!run.fake) {
      // Shift+Tab: the modes the footer names, in order, until the first comes round again.
      const LABEL =
        /(accept edits on|plan mode on|auto mode on|auto-accept edits on|bypass permissions on|don't ask on)/i;
      for (let i = 0; i < 6; i++) {
        tmux.keys("BTab");
        await new Promise((resolve) => setTimeout(resolve, 700));
        const label = LABEL.exec(tmux.capture())?.[1]?.toLowerCase() ?? "default";
        if (visit.cycle.includes(label)) break;
        visit.cycle.push(label);
      }
      visit.reached.cycle = visit.cycle.length > 1;
    }
    run.budget.spendUnobserved("terminal");
    tmux.type(run.fake ? "/compact" : "/compact");
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
  budget: 6,
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
      `Use the Write tool to overwrite ${story} with the single line: web one. Then reply DONE.`,
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
