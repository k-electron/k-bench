import { type AppPage, expect, type Kbench, test } from "./harness.ts";
import { makeRepository } from "./project-files.ts";

// These run on the `phone` project: a touch device narrower than the layout breakpoint.

test("the phone shows a single Pane and no Pane-count toggle", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");

  await expect(app.pane(1)).toBeVisible();
  await expect(app.terminal("session 1")).toBeVisible();
  await expect(app.pane(2)).toHaveCount(0);
  await expect(app.panesToggle).toHaveCount(0);
});

test("the phone shows the open Session's label beside the Menu button", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"), { name: "alpha" });
  await app.createSession("alpha");
  await expect(app.terminal("session 1")).toBeVisible();

  await expect(app.paneLabel(1)).toHaveText("alpha › session 1");
  const menu = await app.page
    .getByRole("button", { name: "Menu", exact: true })
    .boundingBox();
  const label = await app.paneLabel(1).boundingBox();
  if (!menu || !label) throw new Error("The Menu button and the label should both show");
  expect(label.x).toBeGreaterThanOrEqual(menu.x + menu.width);
});

test("the drawer opens from the menu button;tapping a Session opens it and closes the drawer", async ({
  app,
  kbench,
}) => {
  await expect(app.drawer).toBeHidden();
  await app.openDrawer();
  await expect(app.drawer).toBeVisible();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminal("session 1")).toBeVisible();
  await app.openDrawer();
  await app.createSession("project");
  await expect(app.terminal("session 2")).toBeVisible();
  // Opening a Session closes the drawer, so the terminal has the whole screen.
  await expect(app.drawer).toBeHidden();

  await app.openDrawer();
  await app.session("session 1").tap();
  await expect(app.terminal("session 1")).toBeVisible();
  await expect(app.terminal("session 2")).toHaveCount(0);
  await expect(app.drawer).toBeHidden();
});

test("the extra keys reach the shell", async ({ app, kbench }) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  // `cat -vt` prints the control sequences it receives in readable form (^[ is Esc).
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("cat -vt");
  await app.page.keyboard.press("Enter");

  // Letters between the keys keep the sequences apart and show they arrive in order.
  await app.extraKey("Esc").tap();
  await app.page.keyboard.type("A");
  await app.extraKey("Tab").tap();
  await app.page.keyboard.type("B");
  await app.extraKey("Shift Tab").tap();
  await app.page.keyboard.type("C");
  await app.page.keyboard.press("Enter");
  // A Tab only shows as ^I in cat's output, not in the terminal's own echo of the line.
  await expect(terminal).toContainText("^[A^IB^[[ZC");

  await app.extraKey("Up").tap();
  await app.page.keyboard.type("D");
  await app.extraKey("Down").tap();
  await app.page.keyboard.type("E");
  await app.extraKey("Left").tap();
  await app.page.keyboard.type("F");
  await app.extraKey("Right").tap();
  await app.page.keyboard.type("G");
  await app.page.keyboard.press("Enter");
  await expect(terminal).toContainText("^[[AD^[[BE^[[DF^[[CG");
});

test("the extra keys' Enter runs the line the owner typed", async ({ app, kbench }) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  // The shell prints 42 only when it computes the line, so the typed text can't pass for it.
  await app.page.keyboard.type("echo entered-$((6*7))");
  await app.extraKey("Enter").tap();
  await expect(terminal).toContainText("entered-42");
  // The terminal kept focus, so the on-screen keyboard would have stayed up.
  await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
});

test("the extra keys fit in one row on a 375px-wide phone, each 40px tall", async ({
  app,
  kbench,
}) => {
  await app.page.setViewportSize({ width: 375, height: 700 });
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await expect(app.terminal("session 1")).toBeVisible();

  const row = app.page.getByRole("group", { name: "Extra keys", exact: true });
  const names = [
    "Esc",
    "Tab",
    "Shift Tab",
    "Ctrl",
    "Left",
    "Up",
    "Down",
    "Right",
    "Enter",
  ];
  for (const name of names) await expect(app.extraKey(name)).toBeVisible();
  // Smart typing is offered on an iPhone only (see `smart-typing.spec.ts`), so the row has
  // nine keys here and no switch.
  await expect(row.getByRole("button")).toHaveCount(names.length);
  await expect(app.extraKey("Smart typing")).toHaveCount(0);

  const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const rowBox = await row.boundingBox();
  if (!rowBox) throw new Error("The Extra keys row should show");
  let top: number | undefined;
  for (const name of names) {
    const box = await app.extraKey(name).boundingBox();
    if (!box) throw new Error(`${name} should show`);
    expect(box.height).toBe(40);
    // One row: every key starts at the same height.
    top ??= box.y;
    expect(box.y).toBe(top);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  }
});

test("Ctrl applies to the next key only, including keys typed on the keyboard", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("sleep 300");
  await app.page.keyboard.press("Enter");

  const ctrl = app.extraKey("Ctrl");
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
  await app.page.keyboard.type("c");
  // One-shot: it has been used up.
  await expect(ctrl).toHaveAttribute("aria-pressed", "false");

  // The shell answers only once `sleep 300` has been interrupted.
  await app.runMarker(terminal, "interrupted");
});

test("an armed Ctrl waits for the owner's next key through a reconnect", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.keyboard.type("sleep 300");
  await app.page.keyboard.press("Enter");
  const ctrl = app.extraKey("Ctrl");
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute("aria-pressed", "true");

  // On every attach tmux asks the terminal about itself, and the terminal answers on its
  // own: the first thing the new socket sends is those answers, not anything the owner typed.
  const reconnected = app.page.waitForEvent("websocket", (ws) =>
    ws.url().includes("/terminal"),
  );
  await kbench.stopServer();
  await kbench.startServer();
  await (await reconnected).waitForEvent("framesent");

  await expect(ctrl).toHaveAttribute("aria-pressed", "true");
  await app.page.keyboard.type("c");
  // The shell answers only once `sleep 300` has been interrupted.
  await app.runMarker(terminal, "interrupted");
});

test("the phone's open Session survives a reload", async ({ app, kbench }) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  await app.openDrawer();
  await app.createSession("project");
  await expect(app.terminal("session 2")).toBeVisible();
  await app.openDrawer();
  await app.session("session 1").tap();
  await expect(app.terminal("session 1")).toBeVisible();

  await app.page.reload();
  await expect(app.terminal("session 1")).toBeVisible();
  await expect(app.terminal("session 2")).toHaveCount(0);
});

test("with the on-screen keyboard up the app gives the terminal the room and compact keys replace the row", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");
  const input = terminal.getByRole("textbox", { name: "Terminal input" });
  const menu = app.page.getByRole("button", { name: "Menu", exact: true });
  const { rows: rowsBefore } = await app.terminalSize(terminal);
  await expect(menu).toBeVisible();
  await expect(app.extraKey("Ctrl")).toBeVisible();

  // The keyboard takes room from the page and the width stays the same: the height shrinks.
  const viewport = app.page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  await input.focus();
  await app.page.setViewportSize({
    width: viewport.width,
    height: viewport.height - 300,
  });

  await expect(menu).toBeHidden();
  await expect(app.extraKey("Esc")).toBeHidden();
  await expect(app.overlayKey("Enter")).toBeVisible();
  await expect
    .poll(async () => (await app.terminalSize(terminal)).rows)
    .toBeLessThan(rowsBefore);

  // The compact keys type into the Session and leave the keyboard open.
  await app.page.keyboard.type("cat -vt");
  await app.overlayKey("Enter").tap();
  await app.overlayKey("Esc").tap();
  await app.page.keyboard.type("A");
  await app.overlayKey("Tab").tap();
  await app.page.keyboard.type("B");
  await app.overlayKey("Up").tap();
  await app.page.keyboard.type("C");
  await app.overlayKey("Down").tap();
  await app.page.keyboard.type("D");
  await app.overlayKey("Left").tap();
  await app.page.keyboard.type("E");
  await app.overlayKey("Right").tap();
  await app.page.keyboard.type("F");
  await app.overlayKey("Enter").tap();
  await expect(terminal).toContainText("^[A^IB^[[AC^[[BD^[[DE^[[CF");
  await expect(input).toBeFocused();
  // Ctrl and ⇧Tab are only on the full row, with the keyboard down.
  await expect(app.overlayKey("Ctrl")).toHaveCount(0);
  await expect(app.overlayKey("Shift Tab")).toHaveCount(0);

  // Turning the phone sideways changes the width, which is not the keyboard going away.
  await app.page.setViewportSize({ width: 600, height: 300 });
  await expect(app.overlayKey("Enter")).toBeVisible();
  await expect(menu).toBeHidden();

  // Closing the keyboard brings the header and the full row back.
  await app.overlayKey("Close keyboard").tap();
  await expect(menu).toBeVisible();
  await expect(app.extraKey("Ctrl")).toBeVisible();
  await expect(app.extraKey("Shift Tab")).toBeVisible();
  await expect(app.overlayKey("Enter")).toBeHidden();
});

test("the full extra keys row comes back when the keyboard goes away by itself", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createSession("project");
  const terminal = app.terminal("session 1");
  await app.runMarker(terminal, "shellready");

  const viewport = app.page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
  await app.page.setViewportSize({
    width: viewport.width,
    height: viewport.height - 300,
  });
  await expect(app.overlayKey("Enter")).toBeVisible();

  await app.page.setViewportSize(viewport);
  await expect(app.extraKey("Ctrl")).toBeVisible();
  await expect(app.overlayKey("Enter")).toBeHidden();
  await expect(app.page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
});

test("the phone creates a Claude TUI Session from the + button and the New Session dialog", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));

  await app.openNewSessionDialog("project");
  await app.newSessionDialog.getByRole("radio", { name: "Claude TUI" }).check();
  // Every option fits the phone's screen, with Create within reach.
  await expect(
    app.newSessionDialog.getByRole("button", { name: "Create" }),
  ).toBeInViewport();
  await app.createInDialog({ model: "Sonnet", focusView: true });

  await expect(app.newSessionDialog).toBeHidden();
  await expect(app.drawer).toBeHidden();
  await expect(app.terminal("session 1")).toContainText("claude-stub ready");
  await app.openDrawer();
  await expect(app.claudeGlyph("session 1")).toBeVisible();
});

test.describe("Paste in the keyboard-up overlay", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  /**
   * Opens a shell Session running `cat -vet` in raw mode (it prints control characters in
   * readable form), with the program having asked for bracketed paste, then puts the
   * on-screen keyboard up: the field focused and the viewport shorter.
   */
  async function openCatWithKeyboardUp(
    app: AppPage,
    kbench: Kbench,
    options: { bracketedPaste?: boolean } = { bracketedPaste: true },
  ) {
    await app.openDrawer();
    await app.createWorkspace(kbench.instance.makeFolder("project"));
    await app.createSession("project");
    const terminal = app.terminal("session 1");
    await app.runMarker(terminal, "shellready");
    // The shell turns bracketed paste off while a command runs, so the program asks for it.
    await app.runCommand(
      terminal,
      `${options.bracketedPaste ? "printf '\\e[?2004h'; " : ""}stty raw -echo opost onlcr; echo cat-$((6*7)); cat -vet`,
      "cat-42",
    );
    const input = terminal.getByRole("textbox", { name: "Terminal input" });
    await input.focus();
    const viewport = app.page.viewportSize();
    if (!viewport) throw new Error("no viewport");
    await app.page.setViewportSize({
      width: viewport.width,
      height: viewport.height - 300,
    });
    await expect(app.overlayKey("Paste")).toBeVisible();
    return { terminal, input };
  }

  test("Paste puts the clipboard into the Session as one paste and keeps the keyboard up", async ({
    app,
    kbench,
  }) => {
    const { terminal, input } = await openCatWithKeyboardUp(app, kbench);
    await app.page.evaluate('navigator.clipboard.writeText("one\\ntwo")');

    await app.overlayKey("Paste").tap();

    // Bracketed, so the two lines are not run one by one; a newline arrives as a carriage return.
    await expect(terminal).toContainText("^[[200~one^Mtwo^[[201~");
    await expect(input).toBeFocused();
  });

  test("Paste with Ctrl armed sends the character as it is and disarms Ctrl", async ({
    app,
    kbench,
  }) => {
    // A single pasted character is the one an armed Ctrl would turn into a control key.
    const { terminal, input } = await openCatWithKeyboardUp(app, kbench, {
      bracketedPaste: false,
    });
    await app.page.evaluate('navigator.clipboard.writeText("c")');
    // Ctrl is only on the full row, so arm it before the keyboard comes up.
    const viewport = app.page.viewportSize();
    if (!viewport) throw new Error("no viewport");
    await app.page.setViewportSize({
      width: viewport.width,
      height: viewport.height + 300,
    });
    await app.extraKey("Ctrl").tap();
    await expect(app.extraKey("Ctrl")).toHaveAttribute("aria-pressed", "true");
    await input.focus();
    await app.page.setViewportSize(viewport);
    await expect(app.overlayKey("Paste")).toBeVisible();

    await app.overlayKey("Paste").tap();
    // The paste is asynchronous, so wait for it before typing the next letter.
    await expect(terminal).toContainText(/cat-42\s*c/);
    // Ctrl is used up: the next typed letter is a letter, not a control key.
    await app.page.keyboard.type("d");
    await expect(terminal).toContainText(/cat-42\s*cd/);
    await expect(terminal).not.toContainText("^C");
    await expect(terminal).not.toContainText("^D");
  });

  test("Close keyboard still closes the keyboard from its place under the arrows", async ({
    app,
    kbench,
  }) => {
    await openCatWithKeyboardUp(app, kbench);
    const close = await app.overlayKey("Close keyboard").boundingBox();
    const down = await app.overlayKey("Down").boundingBox();
    if (!close || !down) throw new Error("the keys should show");
    expect(close.y).toBeGreaterThan(down.y);

    await app.overlayKey("Close keyboard").tap();
    await expect(app.extraKey("Ctrl")).toBeVisible();
    await expect(app.overlayKey("Paste")).toBeHidden();
  });
});

test("a Claude Agent on the phone has no Extra keys, Return starts a new line and Send sends", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await expect(app.agentRegion("session 1")).toBeVisible();
  // Nothing of the terminal's keys: this is an ordinary input box.
  await expect(
    app.page.getByRole("group", { name: "Extra keys", exact: true }),
  ).toHaveCount(0);

  const input = app.agentInput("session 1");
  await input.tap();
  await app.page.keyboard.type("one");
  await app.page.keyboard.press("Enter");
  await app.page.keyboard.type("two");
  // Return wrote a new line and sent nothing.
  await expect(input).toHaveValue("one\ntwo");
  const conversation = app.agentRegion("session 1").getByRole("log");
  await expect(conversation).not.toContainText("fake claude heard");

  await app
    .agentRegion("session 1")
    .getByRole("button", { name: "Send", exact: true })
    .tap();
  await expect(conversation).toContainText("fake claude heard: one two");
  await expect(input).toHaveValue("");
});

test("on a phone, an image picked from the photo library shows as a thumbnail and goes to Claude with Send", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");

  const [chooser] = await Promise.all([
    app.page.waitForEvent("filechooser"),
    region.getByRole("button", { name: "Attach image" }).tap(),
  ]);
  await chooser.setFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  const thumbnail = region.getByRole("img", { name: "Attached: photo.png" });
  await expect(thumbnail).toBeVisible();
  // It fits the screen: the page does not scroll sideways for it.
  const box = await thumbnail.boundingBox();
  expect(
    box && box.x >= 0 && box.x + box.width <= (app.page.viewportSize()?.width ?? 0),
  ).toBe(true);

  // An image alone is a message.
  await region.getByRole("button", { name: "Send", exact: true }).tap();
  await expect(region.getByRole("img", { name: "Your attachment" })).toBeVisible();
  await expect(region.getByRole("list", { name: "Attached images" })).toHaveCount(0);
  await expect
    .poll(() => kbench.instance.fakeClaude.prompts()[0]?.content)
    .toEqual([expect.objectContaining({ type: "image" })]);
});

test("on a phone, a long-press on a Claude Agent's message shows its raw JSON, and a quick tap does not", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  await app.agentInput("session 1").fill("hello");
  await app
    .agentRegion("session 1")
    .getByRole("button", { name: "Send", exact: true })
    .tap();
  const conversation = app.agentRegion("session 1").getByRole("log");
  const reply = conversation.getByText("fake claude heard: hello", { exact: true });
  await expect(reply).toBeVisible();
  // No `</>` on a phone: the long-press is the way.
  await expect(conversation.getByRole("button", { name: /raw message/i })).toHaveCount(0);

  const box = await reply.boundingBox();
  if (!box) throw new Error("the reply should show");
  const finger = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const touch = await app.page.context().newCDPSession(app.page);
  const send = (type: "touchStart" | "touchEnd") =>
    touch.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchStart" ? [finger] : [],
    });

  // A quick tap is not a long-press.
  await send("touchStart");
  await send("touchEnd");
  await expect(conversation.getByLabel("Raw message")).toHaveCount(0);

  // A finger that stays down shows the message Claude Code sent.
  await send("touchStart");
  const raw = conversation.getByLabel("Raw message", { exact: true });
  await expect(raw).toBeVisible();
  await send("touchEnd");
  expect(JSON.parse((await raw.textContent()) ?? "")).toMatchObject({
    type: "assistant",
    message: { content: [{ type: "text", text: "fake claude heard: hello" }] },
  });
});

test("a Claude Agent's mode line is a button on the phone: a tap cycles the permission mode", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const line = app.agentModeLine("session 1");
  await expect(line).toContainText("Ask before edits");

  await line.tap();
  await expect(line).toContainText("Accept edits");
  await line.tap();
  await expect(line).toContainText("Plan mode");
  await line.tap();
  await expect(line).toContainText("Ask before edits");
});

test("a Claude Agent on the phone has an Interrupt button by the input while Claude works", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const interrupt = region.getByRole("button", { name: "Interrupt" });
  await expect(interrupt).toHaveCount(0);

  kbench.instance.fakeClaude.script([
    { text: "running it" },
    { tool: { name: "Bash", input: { command: "sleep 99" } }, hold: "never" },
  ]);
  await app.agentInput("session 1").tap();
  await app.page.keyboard.type("long job");
  await region.getByRole("button", { name: "Send", exact: true }).tap();
  await expect(region.getByRole("log")).toContainText("running it");
  await interrupt.tap();

  await expect(region.getByRole("log").getByText("Interrupted")).toBeVisible();
  await expect(interrupt).toHaveCount(0);
});

test("a Claude Agent's Transcript fits the phone: long lines wrap or scroll inside their block, and tapping opens collapsed output", async ({
  app,
  kbench,
}) => {
  const long = "x".repeat(200);
  const folder = kbench.instance.makeFolder("project");
  kbench.instance.fakeClaude.script([
    { text: `A reading-width paragraph with a long word ${long} in it.` },
    {
      tool: { name: "Bash", input: { command: `echo ${long}` } },
      result: Array.from({ length: 8 }, (_, i) => `${i + 1} ${long}`).join("\n"),
    },
    {
      tool: {
        name: "Edit",
        input: { file_path: `${folder}/${long}.txt`, old_string: long, new_string: "y" },
      },
    },
  ]);
  await app.openDrawer();
  await app.createWorkspace(folder);
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  await app.agentInput("session 1").tap();
  await app.page.keyboard.type("go");
  await region.getByRole("button", { name: "Send", exact: true }).tap();

  await expect(region.getByRole("article", { name: /^Edit\(/ })).toBeVisible();
  // The header and the conversation stay inside the screen: nothing makes the page scroll sideways.
  const overflow = () =>
    app.page.evaluate<{ page: number; log: number }>(`(() => {
      const log = document.querySelector('[role="log"]');
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        log: (log?.scrollWidth ?? 0) - (log?.clientWidth ?? 0),
      };
    })()`);
  expect(await overflow()).toEqual({ page: 0, log: 0 });

  const bash = region.getByRole("article", { name: /^Bash\(/ });
  await bash.getByRole("button", { name: "+3 lines, tap to expand" }).tap();
  await expect(bash.getByText(/^8 x+$/)).toBeVisible();
  expect(await overflow()).toEqual({ page: 0, log: 0 });
  await expect(region.getByRole("log")).toContainText("A reading-width paragraph");
});

test("on a phone, @ lists the Workspace's files inside the screen and a tap inserts the path", async ({
  app,
  kbench,
}) => {
  const folder = kbench.instance.makeFolder("project");
  makeRepository(folder, [
    "src/app.ts",
    "src/a/deeply/nested/folder/for/a/long/path/app-routes.ts",
  ]);
  await app.openDrawer();
  await app.createWorkspace(folder);
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const input = app.agentInput("session 1");

  await input.tap();
  await app.page.keyboard.type("see @app");
  const picker = region.getByRole("listbox", { name: "Files" });
  await expect(picker.getByRole("option")).toHaveCount(2);
  // The long path is cut at the edge, not pushed past it: nothing scrolls sideways.
  const box = await picker.boundingBox();
  const width = app.page.viewportSize()?.width ?? 0;
  expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  expect(
    await app.page.evaluate<number>(
      "document.documentElement.scrollWidth - window.innerWidth",
    ),
  ).toBe(0);

  await picker.getByRole("option", { name: /^app\.ts/ }).tap();
  await expect(input).toHaveValue("see @src/app.ts ");
  await expect(input).toBeFocused();
  await expect(picker).toHaveCount(0);
  await region.getByRole("button", { name: "Send", exact: true }).tap();
  await expect(region.getByRole("log")).toContainText(
    "fake claude heard: see @src/app.ts",
  );
});

test("on the phone Claude's questions and plan are answered by tapping, with the choices in reach however long the plan is", async ({
  app,
  kbench,
}) => {
  await app.openDrawer();
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const { fakeClaude } = kbench.instance;
  const steps = Array.from({ length: 60 }, (_, i) => `- step ${i + 1}`).join("\n");
  fakeClaude.script([
    {
      tool: {
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which colour?",
              header: "Colour",
              multiSelect: false,
              options: [
                { label: "Red", description: "Warm" },
                { label: "Blue", description: "Cool" },
              ],
            },
          ],
        },
      },
      ask: true,
    },
    {
      tool: { name: "ExitPlanMode", input: { plan: `## The plan\n\n${steps}` } },
      ask: true,
    },
    { text: "all done" },
  ]);
  const region = app.agentRegion("session 1");
  await app.agentInput("session 1").tap();
  await app.page.keyboard.type("go");
  await region.getByRole("button", { name: "Send", exact: true }).tap();

  await app.questionPrompt("session 1").getByRole("button", { name: "2. Blue" }).tap();
  // The plan is longer than the screen: it scrolls inside its panel and the choices stay on it.
  const yes = app
    .planPrompt("session 1")
    .getByRole("button", { name: "1. Yes, proceed" });
  await expect(yes).toBeInViewport();
  await yes.tap();
  await expect(region.getByRole("log")).toContainText("all done");
  await expect(region.getByRole("log")).toContainText("question: Which colour? → Blue");
});
