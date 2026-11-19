import { crc32, deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness.ts";

// Claude Code is the fake from test/harness/fake-claude.sh; nothing here runs the real
// `claude`, and the Agent Runtime is the real one.

/** A real 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A valid PNG `width` pixels wide and one high, all black: small on disk, wide on screen. */
function widePng(width: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(width + 1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = (name: string, buffer: Buffer = PNG) => ({
  name,
  mimeType: "image/png",
  buffer,
});

/** Pastes or drops the files on the input, as the browser would deliver them. */
async function deliver(
  page: Page,
  how: "paste" | "drop",
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
) {
  const sent = files.map(({ name, mimeType, buffer }) => ({
    name,
    mimeType,
    bytes: [...buffer],
  }));
  // A script as text: the test project has no DOM types.
  await page.evaluate(
    `(() => {
      const field = document.querySelector('textarea[aria-label="Message Claude"]');
      const data = new DataTransfer();
      for (const file of ${JSON.stringify(sent)}) {
        data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }));
      }
      field.dispatchEvent(
        ${JSON.stringify(how)} === "paste"
          ? new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
          : new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
      );
    })()`,
  );
}

test("images attached by the button, paste and drop show as thumbnails, can be removed, and reach Claude in order", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const thumbnails = region.getByRole("list", { name: "Attached images" });

  const [chooser] = await Promise.all([
    app.page.waitForEvent("filechooser"),
    region.getByRole("button", { name: "Attach image" }).click(),
  ]);
  await chooser.setFiles(png("first.png"));
  await expect(
    thumbnails.getByRole("img", { name: "Attached: first.png" }),
  ).toBeVisible();
  await deliver(app.page, "paste", [png("second.png")]);
  await deliver(app.page, "drop", [png("third.png")]);
  await expect(thumbnails.getByRole("img")).toHaveCount(3);

  await region.getByRole("button", { name: "Remove first.png" }).click();
  await expect(thumbnails.getByRole("img")).toHaveCount(2);

  await app.agentInput("session 1").fill("What are these?");
  await app.agentInput("session 1").press("Enter");
  const conversation = region.getByRole("log");
  await expect(conversation).toContainText("fake claude heard: What are these?");
  // Sent: the thumbnails under the input are gone, the images are in the conversation, and
  // they are still there, loaded from the server, after a reload.
  await expect(thumbnails).toHaveCount(0);
  await app.page.reload();
  const sent = app.agentRegion("session 1").getByRole("img", { name: "Your attachment" });
  await expect(sent).toHaveCount(2);
  await expect(sent.first()).toHaveJSProperty("naturalWidth", 1);

  // Claude got the two that were left, before the text.
  const [prompt] = kbench.instance.fakeClaude.prompts();
  expect(prompt?.content).toEqual([
    expect.objectContaining({ type: "image" }),
    expect.objectContaining({ type: "image" }),
    { type: "text", text: "What are these?" },
  ]);
});

test("an image over Claude's limits shows a message and is never uploaded", async ({
  app,
  kbench,
}) => {
  await app.createWorkspace(kbench.instance.makeFolder("project"));
  await app.createClaudeAgent("project");
  const region = app.agentRegion("session 1");
  const uploads: string[] = [];
  app.page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/agent/images")) {
      uploads.push(request.url());
    }
  });

  const [chooser] = await Promise.all([
    app.page.waitForEvent("filechooser"),
    region.getByRole("button", { name: "Attach image" }).click(),
  ]);
  // 6 MB of file, and a PNG too wide for Claude (8001 pixels).
  await chooser.setFiles([
    png("heavy.png", Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)])),
    png("wide.png", widePng(8001)),
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") },
  ]);

  const alert = region.getByRole("alert");
  await expect(alert).toContainText("heavy.png is over Claude's 5 MB");
  await expect(alert).toContainText("wide.png is over Claude's 8000 pixel");
  await expect(region.getByRole("list", { name: "Attached images" })).toHaveCount(0);
  // Nothing to send yet: an empty message with no image cannot go.
  await expect(region.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  expect(uploads).toEqual([]);

  // A good image still goes, alone.
  await deliver(app.page, "paste", [png("fine.png")]);
  await region.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => kbench.instance.fakeClaude.prompts().length).toBe(1);
  expect(kbench.instance.fakeClaude.prompts()[0]?.content).toEqual([
    expect.objectContaining({ type: "image" }),
  ]);
  expect(uploads).toHaveLength(1);
});
