import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/shared/agent-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeClaude } from "./harness/fake-claude.ts";
import type { TestServer } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import { killTmuxServer } from "./harness/tmux.ts";

// Claude Code is the fake `claude`: the SDK-driven one for the Agent, the terminal stub while
// the Session is in the terminal. Both save the conversation to the instance's own Claude Code
// folder, which the Agent Runtime (the real one, with the real Agent SDK) reads back when the
// Session returns to the web.

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block) => (block as { text?: string }).text ?? "").join("")
      : "";

/** What the Transcript shows of the log, in order: prompts, replies and dividers. */
function transcript(entries: LogEntry[]): string[] {
  const sent = new Set(
    entries.flatMap((entry) => (entry.kind === "prompt" ? [entry.id] : [])),
  );
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "prompt") lines.push(`> ${entry.text}`);
    else if (entry.kind === "divider") lines.push(`--- ${entry.label} ---`);
    else if (entry.kind === "sdk") {
      const { message } = entry;
      const inner = (message.message ?? {}) as { content?: unknown };
      if (message.type === "assistant") lines.push(textOf(inner.content));
      else if (message.type === "user" && message.isCompactSummary === true) {
        lines.push(`summary: ${textOf(inner.content).slice(0, 30)}`);
      } else if (
        message.type === "user" &&
        message.isReplay === true &&
        !sent.has(message.uuid as string)
      ) {
        lines.push(`> ${textOf(inner.content)}`);
      }
    }
  }
  return lines.filter((line) => line !== "");
}

async function loggedIn(server: TestServer, sessionId: string): Promise<LogEntry[]> {
  const agent = await server.openAgent(sessionId);
  await agent.sync();
  const { entries } = agent;
  agent.close();
  return entries;
}

const sessionOf = async (server: TestServer, sessionId: string) =>
  (await server.state()).workspaces
    .flatMap((workspace) => workspace.sessions)
    .find((session) => session.id === sessionId);

/** The conversation IDs the Agent's Claude Code was started with, in order. */
function agentStarts(fakeClaude: FakeClaude): string[] {
  return fakeClaude
    .received()
    .flatMap((entry) =>
      entry.kind === "start"
        ? entry.argv.filter((arg) => /^--(session-id|resume)=/.test(arg))
        : [],
    );
}

describe("Open in web", () => {
  it("imports what the terminal did, once, between dividers after the Agent's own turns, and carries on in the same conversation", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const agent = await server.openAgent(session.id);
    await agent.sync();
    agent.prompt("before");
    await agent.waitForEntry(isResult, "the answer");
    await server.post(`/api/sessions/${session.id}/open-in-terminal`);
    const terminal = await server.openTerminal(session.id);
    await terminal.waitForOutput("claude-stub ready");
    terminal.run("from the terminal");
    await terminal.waitForOutput("claude-stub heard: from the terminal");

    const response = await server.post(`/api/sessions/${session.id}/open-in-web`);

    expect(response.status).toBe(200);
    expect(await agent.waitForClose()).toBe(4410);
    expect(await terminal.waitForClose()).toBeTruthy();
    expect(await sessionOf(server, session.id)).toMatchObject({
      kind: "claude",
      interface: "agent",
      status: "running",
    });
    const imported = [
      "> before",
      "fake claude heard: before",
      "--- In the terminal ---",
      "> from the terminal",
      "claude-stub heard: from the terminal",
      "--- Back in web ---",
    ];
    expect(transcript(await loggedIn(server, session.id))).toEqual(imported);

    // Back and forth with nothing new in the terminal adds nothing, and the next turn in the
    // terminal adds only itself.
    await server.post(`/api/sessions/${session.id}/open-in-terminal`);
    await server.post(`/api/sessions/${session.id}/open-in-web`);
    expect(transcript(await loggedIn(server, session.id))).toEqual(imported);
    await server.post(`/api/sessions/${session.id}/open-in-terminal`);
    const again = await server.openTerminal(session.id);
    await again.waitForOutput("claude-stub ready");
    again.run("one more");
    await again.waitForOutput("claude-stub heard: one more");
    await server.post(`/api/sessions/${session.id}/open-in-web`);
    expect(transcript(await loggedIn(server, session.id))).toEqual([
      ...imported,
      "--- In the terminal ---",
      "> one more",
      "claude-stub heard: one more",
      "--- Back in web ---",
    ]);

    // The Agent carries on in the one conversation, and what it says comes after the import.
    const web = await server.openAgent(session.id);
    await web.sync();
    const answered = web.entries.filter(isResult).length;
    web.prompt("after");
    await pollUntil(() => web.entries.filter(isResult).length === answered + 1, {
      description: "the answer after the switch",
    });
    expect(transcript(web.entries).slice(-2)).toEqual([
      "> after",
      "fake claude heard: after",
    ]);
    const [first, ...resumed] = agentStarts(instance.fakeClaude);
    const conversation = (first as string).split("=")[1];
    expect(resumed.length).toBeGreaterThan(0);
    for (const start of resumed) expect(start).toBe(`--resume=${conversation}`);
  });

  it("says so when the terminal compacted, and starts from the summary", async () => {
    const { server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const agent = await server.openAgent(session.id);
    await agent.sync();
    agent.prompt("before");
    await agent.waitForEntry(isResult, "the answer");
    await server.post(`/api/sessions/${session.id}/open-in-terminal`);
    const terminal = await server.openTerminal(session.id);
    await terminal.waitForOutput("claude-stub ready");
    terminal.run("/compact");
    await terminal.waitForOutput("claude-stub compacted");
    terminal.run("after compacting");
    await terminal.waitForOutput("claude-stub heard: after compacting");

    await server.post(`/api/sessions/${session.id}/open-in-web`);

    expect(transcript(await loggedIn(server, session.id))).toEqual([
      "> before",
      "fake claude heard: before",
      "--- Compacted in the terminal: earlier turns above are from before ---",
      "summary: This session is being continue",
      "> after compacting",
      "claude-stub heard: after compacting",
      "--- Back in web ---",
    ]);
  });

  it("says so when the terminal's turns cannot be matched to the Agent's, instead of importing nothing silently", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const agent = await server.openAgent(session.id);
    await agent.sync();
    agent.prompt("before");
    await agent.waitForEntry(isResult, "the answer");
    await server.post(`/api/sessions/${session.id}/open-in-terminal`);
    const terminal = await server.openTerminal(session.id);
    await terminal.waitForOutput("claude-stub ready");
    terminal.run("from the terminal");
    await terminal.waitForOutput("claude-stub heard: from the terminal");
    // Claude Code rewrote the saved chain, so that none of the IDs k-bench holds is in it.
    const projects = join(instance.config.claudeConfigDir as string, "projects");
    for (const folder of readdirSync(projects)) {
      for (const file of readdirSync(join(projects, folder))) {
        const path = join(projects, folder, file);
        const ids = new Map<string, string>();
        writeFileSync(
          path,
          readFileSync(path, "utf8").replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
            (id) => {
              if (id === file.replace(/\.jsonl$/, "")) return id;
              if (!ids.has(id)) ids.set(id, randomUUID());
              return ids.get(id) as string;
            },
          ),
        );
      }
    }

    const response = await server.post(`/api/sessions/${session.id}/open-in-web`);

    expect(response.status).toBe(200);
    const shown = transcript(await loggedIn(server, session.id));
    expect(shown.slice(0, 2)).toEqual(["> before", "fake claude heard: before"]);
    expect(shown.join("\n")).toMatch(/--- The terminal's turns could not be matched/);
    expect(shown.join("\n")).not.toContain("claude-stub heard");
  });

  it("takes the whole conversation of a Session that began as a Claude TUI, also from a Stopped one, and the Agent resumes it", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeSession(workspace.id);
    const terminal = await server.openTerminal(session.id);
    await terminal.waitForOutput("claude-stub ready");
    terminal.run("hello from the start");
    await terminal.waitForOutput("claude-stub heard: hello from the start");
    killTmuxServer(instance.config.tmuxSocket);
    await pollUntil(
      async () => (await sessionOf(server, session.id))?.status === "stopped",
      {
        description: "the Session to be Stopped",
      },
    );

    const response = await server.post(`/api/sessions/${session.id}/open-in-web`);

    expect(response.status).toBe(200);
    expect(transcript(await loggedIn(server, session.id))).toEqual([
      "--- In the terminal ---",
      "> hello from the start",
      "claude-stub heard: hello from the start",
      "--- Back in web ---",
    ]);
    const web = await server.openAgent(session.id);
    await web.sync();
    web.prompt("now in web");
    await pollUntil(() => web.entries.filter(isResult).length === 1, {
      description: "the answer in web",
    });
    expect(agentStarts(instance.fakeClaude)[0]).toMatch(/^--resume=/);
  });

  it("is refused for a shell, for a Claude Agent, and for an unknown Session", async () => {
    const { server, workspace } = await boot();
    const shell = await server.createSession(workspace.id);
    const agent = await server.createClaudeAgent(workspace.id);

    expect((await server.post(`/api/sessions/${shell.id}/open-in-web`)).status).toBe(422);
    expect((await server.post(`/api/sessions/${agent.id}/open-in-web`)).status).toBe(422);
    expect((await server.post("/api/sessions/nope/open-in-web")).status).toBe(404);
  });
});
