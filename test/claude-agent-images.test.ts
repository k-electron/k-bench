import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentFolder } from "../src/agent/paths.ts";
import { type AgentClient, isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime, the Agent SDK and the server are real.

/** A real 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Waits until the client has seen this many turns end. */
const turnsEnded = (client: AgentClient, count: number) =>
  pollUntil(() => client.entries.filter(isResult).length >= count || undefined, {
    description: `${count} turns to end`,
  });

const upload = (
  server: { post(path: string, body?: unknown): Promise<Response> },
  sessionId: string,
  mediaType: string,
  data: string,
) => server.post(`/api/sessions/${sessionId}/agent/images`, { mediaType, data });

describe("images in a Claude Agent's prompts", () => {
  it("goes to Claude as an image block before the text, shows again from the server, and goes with the Session", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);

    const stored = await upload(server, session.id, "image/png", PNG.toString("base64"));
    expect(stored.status).toBe(201);
    const { name } = (await stored.json()) as { name: string };

    const client = await server.openAgent(session.id);
    await client.sync();
    client.prompt("What is this?", randomUUID(), [name]);
    await client.waitForEntry(isResult, "the turn's result");

    // The fake received an image block carrying the very bytes uploaded, then the text.
    const [prompt] = instance.fakeClaude.prompts();
    expect(prompt?.content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") },
      },
      { type: "text", text: "What is this?" },
    ]);
    // The log names the image and never holds its bytes.
    const logged = client.entries.find((entry) => entry.kind === "prompt");
    expect(logged).toMatchObject({ text: "What is this?", images: [name] });
    expect(JSON.stringify(logged)).not.toContain(PNG.toString("base64"));

    // The Pane can show it again, after a reload, from the server.
    const again = await server.request(
      `/api/sessions/${session.id}/agent/images/${name}`,
    );
    expect(again.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await again.arrayBuffer())).toEqual(PNG);

    // Deleting the Session takes its images with it.
    const folder = agentFolder(instance.config.dataDir, session.id);
    expect(existsSync(join(folder, "images", name))).toBe(true);
    expect((await server.deleteSession(session.id)).status).toBe(204);
    expect(existsSync(folder)).toBe(false);
  });

  it("sends an image with no text, and plain text stays plain text", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const { name } = (await (
      await upload(server, session.id, "image/png", PNG.toString("base64"))
    ).json()) as { name: string };
    const client = await server.openAgent(session.id);
    await client.sync();

    client.prompt("", randomUUID(), [name]);
    await client.waitForEntry(isResult, "the turn's result");
    client.prompt("just words");
    await turnsEnded(client, 2);

    const [first, second] = instance.fakeClaude.prompts();
    expect(first?.content).toEqual([expect.objectContaining({ type: "image" })]);
    expect(second?.content).toBe("just words");
  });

  it("refuses what Claude would, and stores none of it", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const png = PNG.toString("base64");
    // Over Claude's 5 MB, measured on the base64 text.
    const huge = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]).toString("base64");

    // Well over it, the body is refused before it is all read; see the next test.
    expect((await upload(server, session.id, "image/png", huge)).status).toBe(413);
    expect((await upload(server, session.id, "image/bmp", png)).status).toBe(422);
    // A label is not trusted: these bytes are not a JPEG, and this is not base64.
    expect((await upload(server, session.id, "image/jpeg", png)).status).toBe(422);
    expect((await upload(server, session.id, "image/png", "not base64!")).status).toBe(
      422,
    );
    // The body must be declared JSON (the second line behind the Origin check).
    const plain = await server.request(`/api/sessions/${session.id}/agent/images`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ mediaType: "image/png", data: png }),
    });
    expect(plain.status).toBe(415);
    // Only a Claude Agent has images.
    const shell = await server.createSession(workspace.id);
    expect((await upload(server, shell.id, "image/png", png)).status).toBe(404);

    const folder = agentFolder(instance.config.dataDir, session.id);
    expect(existsSync(join(folder, "images"))).toBe(false);
  });

  it("refuses an oversize body with a 413 whether or not it says how long it is, and stores nothing", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const path = `/api/sessions/${session.id}/agent/images`;
    const body = JSON.stringify({
      mediaType: "image/png",
      data: "A".repeat(20 * 1024 * 1024),
    });

    const sized = await server.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    // Sent in pieces, with no length up front.
    const piece = Buffer.from(body);
    const chunked: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          for (let at = 0; at < piece.length; at += 1024 * 1024) {
            controller.enqueue(piece.subarray(at, at + 1024 * 1024));
          }
          controller.close();
        },
      }),
      duplex: "half",
    };
    const streamed = await server.request(path, chunked);

    expect(sized.status).toBe(413);
    expect(((await sized.json()) as { error: string }).error).toMatch(/too large/i);
    expect(streamed.status).toBe(413);
    const folder = agentFolder(instance.config.dataDir, session.id);
    expect(existsSync(join(folder, "images"))).toBe(false);
  });

  it("answers a prompt whose image has gone, and refuses a name that is not a stored image", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    // Well formed, but never uploaded: Claude is told, and the Agent carries on.
    client.prompt("look", randomUUID(), [`${randomUUID()}.png`]);
    await client.waitForEntry(isResult, "the turn's result");

    // A path out of the folder never reaches the runtime's file reads.
    client.sendRaw(
      JSON.stringify({
        type: "prompt",
        id: randomUUID(),
        text: "x",
        images: ["../../log.jsonl"],
      }),
    );
    await client.waitForMessage(
      (message): message is Extract<typeof message, { type: "error" }> =>
        message.type === "error",
      "an error for the bad name",
    );
    client.prompt("still alive");
    await turnsEnded(client, 2);
  });
});
