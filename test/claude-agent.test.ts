import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentFolder, agentsRoot } from "../src/agent/paths.ts";
import { agentPath } from "../src/shared/agent-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import type { FakeReceived } from "./harness/fake-claude.ts";
import { createTestInstance } from "./harness/instance.ts";
import { pollUntil } from "./harness/poll.ts";
import {
  endSessionLeavingEmptyServer,
  killTmuxServer,
  tmuxSessionNames,
} from "./harness/tmux.ts";

/** What the fake Claude Code was started with, one entry per start. */
const starts = (received: FakeReceived[]) =>
  received.flatMap((entry) => (entry.kind === "start" ? [entry] : []));

describe("a Claude Agent", () => {
  it("answers a prompt sent on its socket: claude gets it as typed and the reply streams back in order, fragments live", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    fakeClaude.configure({ version: "2.1.200" });
    const session = await server.createClaudeAgent(workspace.id);

    const client = await server.openAgent(session.id);
    const hello = await pollUntil(() => client.hello, { description: "the hello" });
    // Claude Code's own version is known before the first message is sent.
    expect(hello).toMatchObject({ protocol: 1, claudeVersion: "2.1.200" });
    expect(hello.runtimeBuildId).toMatch(/^[0-9a-f]{64}$/);
    expect(hello.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);

    await client.sync();
    fakeClaude.script([{ text: ["first ", { hold: "gate" }, "second"] }]);
    const text = "Please  look\nat   this";
    const id = client.prompt(text);

    // The first fragment is on the socket while the turn is still going: it is live, not
    // something delivered with the finished message.
    await pollUntil(() => client.fragments.includes("first "), {
      description: "the first fragment",
    });
    expect(client.assistantTexts).toEqual([]);
    fakeClaude.release("gate");
    await client.waitForEntry(isResult, "the turn's result");

    expect(client.fragments).toEqual(["first ", "second"]);
    expect(client.assistantTexts).toEqual(["first second"]);
    // As typed, with the ID the client chose, which Claude Code replays.
    expect(fakeClaude.prompts()).toEqual([{ uuid: id, content: text }]);
    // In order: numbered without gaps, the prompt before the reply it caused.
    const entries = client.entries;
    expect(entries.map((entry) => entry.seq)).toEqual(entries.map((_, i) => i + 1));
    const sdk = (type: string) =>
      entries.findIndex((e) => e.kind === "sdk" && e.message.type === type);
    expect(entries[0]?.kind).toBe("runtime");
    expect(entries.findIndex((e) => e.kind === "prompt")).toBeLessThan(sdk("assistant"));
    expect(sdk("assistant")).toBeLessThan(sdk("result"));
  });

  it("is driven with checkpointing, partial and replayed messages, and the folder it belongs to", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    client.prompt("hi");
    await client.waitForEntry(isResult, "the turn's result");

    const [start, ...others] = starts(instance.fakeClaude.received());
    expect(others).toEqual([]);
    expect(start?.argv).toEqual(
      expect.arrayContaining(["--include-partial-messages", "--replay-user-messages"]),
    );
    expect(start?.argv.some((arg) => arg.startsWith("--session-id="))).toBe(true);
    // The settings sources are Claude Code's own defaults: not narrowed by a flag.
    expect(start?.argv.join(" ")).not.toContain("--setting-sources");
    // File checkpointing is on from the first launch: it cannot be turned on later.
    expect(start?.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING).toBe("true");
    expect(start?.cwd).toBe(workspace.folder);
  });

  it("sends every message to every connection that asked for it, and only hello and status to one that did not", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const first = await server.openAgent(session.id);
    const second = await server.openAgent(session.id);
    const quiet = await server.openAgent(session.id);
    await first.sync();
    await second.sync();

    instance.fakeClaude.script([{ text: ["one ", "two"] }]);
    first.prompt("hello");
    await first.waitForEntry(isResult, "the turn's result");
    await second.waitForEntry(isResult, "the turn's result");

    expect(second.entries).toEqual(first.entries);
    expect(second.fragments).toEqual(first.fragments);
    expect(first.fragments).toEqual(["one ", "two"]);
    // One that joins later is caught up from any point, with no repeat of what it has.
    const late = await server.openAgent(session.id);
    await late.sync(2);
    expect(late.entries).toEqual(first.entries.slice(2));
    expect(quiet.messages[0]?.type).toBe("hello");
    expect(quiet.messages.every((m) => m.type === "hello" || m.type === "status")).toBe(
      true,
    );
  });

  it("gives a connection that joins mid-reply the text so far as one snapshot, then only the fragments that follow", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const first = await server.openAgent(session.id);
    await first.sync();
    fakeClaude.script([{ text: ["one ", "two ", { hold: "gate" }, "three"] }]);
    first.prompt("go");
    await pollUntil(() => first.fragments.includes("two "), {
      description: "the second fragment",
    });

    const late = await server.openAgent(session.id);
    await late.sync();
    fakeClaude.release("gate");
    await late.waitForEntry(isResult, "the turn's result");

    // "one " and "two " arrive as one piece of text, not as the fragments they were.
    expect(late.snapshots.map((s) => s.blocks)).toEqual([
      [{ index: 0, type: "text", text: "one two " }],
    ]);
    expect(late.fragments).toEqual(["three"]);
    expect(late.assistantTexts).toEqual(["one two three"]);
    expect(first.fragments).toEqual(["one ", "two ", "three"]);
    // Nothing is streaming once the turn is over: a later join gets no snapshot.
    const after = await server.openAgent(session.id);
    await after.sync();
    expect(after.snapshots).toEqual([]);
  });

  it("gives a connection that comes back mid-turn, from its last sequence number, every later entry once, then what is live", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const away = await server.openAgent(session.id);
    await away.sync();
    fakeClaude.script([{ text: ["a ", { hold: "gate" }, "b"] }]);
    fakeClaude.script([{ text: "second" }]);
    away.prompt("first");
    await pollUntil(() => away.fragments.includes("a "), {
      description: "the first fragment",
    });
    const had = away.lastSeq;
    away.close();

    const back = await server.openAgent(session.id);
    await back.sync(had);
    fakeClaude.release("gate");
    await back.waitForEntry(isResult, "the first turn's result");
    back.prompt("second");
    await pollUntil(() => back.entries.filter(isResult).length === 2, {
      description: "the second turn's result",
    });

    const whole = await server.openAgent(session.id);
    await whole.sync();
    // Exactly the entries it missed: none skipped, none repeated, live ones included.
    expect(back.entries).toEqual(whole.entries.filter((entry) => entry.seq > had));
    expect(back.entries.map((entry) => entry.seq)).toEqual(
      back.entries.map((_, i) => had + 1 + i),
    );
    expect(back.snapshots.map((s) => s.blocks[0]?.text)).toEqual(["a "]);
    expect(back.fragments).toEqual(["b", "second"]);
  });

  it("keeps running when the server restarts mid-turn, finishes the turn, and a reconnected client has it whole with no gap or repeat", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    const session = await server.createClaudeAgent(workspace.id);
    const before = await server.openAgent(session.id);
    const { runtimeBuildId } = await pollUntil(() => before.hello, {
      description: "the hello",
    });
    await before.sync();
    fakeClaude.script([{ text: ["a ", { hold: "gate" }, "b"] }]);
    before.prompt("go");
    await pollUntil(() => before.fragments.includes("a "), {
      description: "the first fragment",
    });
    const had = before.lastSeq;

    await server.stop();
    // The browser's socket is dropped, not told the Session ended: it may come back.
    expect(await before.waitForClose()).not.toBe(4410);
    fakeClaude.release("gate");
    const restarted = await instance.start();

    const after = await restarted.openAgent(session.id);
    await after.sync(had);
    await after.waitForEntry(isResult, "the turn's result");
    after.prompt("again");
    await pollUntil(() => after.entries.filter(isResult).length === 2, {
      description: "the second turn's result",
    });

    const whole = await restarted.openAgent(session.id);
    await whole.sync();
    expect(after.entries).toEqual(whole.entries.filter((entry) => entry.seq > had));
    expect(after.entries.map((entry) => entry.seq)).toEqual(
      after.entries.map((_, i) => had + 1 + i),
    );
    expect(after.assistantTexts).toEqual(["a b", "fake claude heard: again"]);
    // The very same runtime and Claude Code carried on: neither was started a second time.
    expect(whole.hello?.runtimeBuildId).toBe(runtimeBuildId);
    expect(whole.entries.filter((e) => e.kind === "runtime")).toMatchObject([
      { event: "started" },
    ]);
    expect(starts(fakeClaude.received())).toHaveLength(1);
  });

  it("refuses what it does not understand, and sends none of it to claude", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    client.sendRaw("not json");
    client.sendRaw(JSON.stringify({ type: "prompt", id: "not-a-uuid", text: "hi" }));
    client.sendRaw(
      JSON.stringify({ type: "prompt", id: "6e6c0f4e-3a11-4c0e-9c1d-0a5d5b8e2b10" }),
    );
    client.sendRaw(JSON.stringify({ type: "sync", afterSeq: 0 }));

    const errors = () => client.messages.filter((m) => m.type === "error");
    await pollUntil(() => errors().length === 4, { description: "four refusals" });
    expect(errors().map((e) => (e.type === "error" ? e.code : ""))).toEqual([
      "bad_message",
      "bad_message",
      "bad_message",
      "already_synced",
    ]);
    // A real prompt still goes through afterwards: the connection was not harmed.
    client.prompt("hello");
    await client.waitForEntry(isResult, "the turn's result");
    expect(instance.fakeClaude.prompts().map((p) => p.content)).toEqual(["hello"]);
  });

  it("keeps its files from every other user of the Host", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);

    const { dataDir } = instance.config;
    for (const folder of [agentsRoot(dataDir), agentFolder(dataDir, session.id)]) {
      expect(statSync(folder).mode & 0o777).toBe(0o700);
    }
  });

  it("shows as a Claude Session in the Agent interface, which the New Session dialog remembers with its Launch options", async () => {
    const { server, workspace } = await boot();
    const options = { model: "opus", effort: "high", advisor: "off", focusView: true };
    await server.createClaudeSession(workspace.id, { name: "tui", claude: options });
    await server.createSession(workspace.id, "shell");
    const agentOptions = { model: "sonnet", effort: "low", advisor: "opus" };
    await server.createClaudeAgent(workspace.id, { name: "agent", claude: agentOptions });

    const state = await server.state();
    const sessions = state.workspaces[0]?.sessions.map((s) => [
      s.name,
      s.kind,
      s.interface,
    ]);
    expect(sessions).toEqual([
      ["tui", "claude", "tui"],
      ["shell", "shell", undefined],
      ["agent", "claude", "agent"],
    ]);
    const last = await (await server.request("/api/new-session/last")).json();
    expect(last).toEqual({
      kind: "claude-agent",
      claude: { ...agentOptions, focusView: false },
    });
  });

  it("is reachable only with the owner's login and from the app's own origin", async () => {
    const { server, workspace } = await boot();
    const { id } = await server.createClaudeAgent(workspace.id);
    const path = agentPath(id);

    expect(await server.upgradeStatus(path)).toBe(101);
    expect(await server.anonymous().upgradeStatus(path)).toBe(403);
    expect(await server.as("stranger@example.com").upgradeStatus(path)).toBe(403);
    // A page on another site, even with the owner's login.
    const evil = server.withHeaders({ origin: "https://evil.example" });
    expect(await evil.upgradeStatus(path)).toBe(403);
  });

  it("is never given a terminal", async () => {
    const { server, workspace } = await boot();
    const agent = await server.createClaudeAgent(workspace.id);
    const shell = await server.createSession(workspace.id);

    const terminal = await server.openTerminal(agent.id);
    expect(await terminal.waitForClose()).toBe(4410);
    // And a shell has no agent socket.
    const client = await server.openAgent(shell.id);
    expect(await client.waitForClose()).toBe(4410);
  });

  it("is ended by deleting its Session: its runtime and Claude Code stop and its folder goes", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    client.prompt("hello");
    await client.waitForEntry(isResult, "the turn's result");

    const response = await server.deleteSession(session.id);

    expect(response.status).toBe(204);
    // The socket is told the Session ended, for good.
    expect(await client.waitForClose()).toBe(4410);
    expect(tmuxSessionNames(instance.config.tmuxSocket)).toEqual([]);
    expect(readdirSync(agentsRoot(instance.config.dataDir))).toEqual([]);
    // Claude Code was closed down, not left running.
    await pollUntil(
      () =>
        instance.fakeClaude
          .received()
          .some((e) => e.kind === "closed" || e.kind === "terminated"),
      { description: "Claude Code to be closed" },
    );
    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
  });

  it("is deleted even when its tmux session ended an instant before, as tmux's server was exiting", async () => {
    // A runtime that exits ends its own tmux session, and with the last one tmux's server
    // exits a moment later: deleting the Agent in that moment must not fail on its own end.
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    endSessionLeavingEmptyServer(instance.config.tmuxSocket, session.id);

    const response = await server.deleteSession(session.id);

    expect(response.status).toBe(204);
    expect(readdirSync(agentsRoot(instance.config.dataDir))).toEqual([]);
    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
  });

  it("is ended by deleting its Workspace, along with the other Sessions in it", async () => {
    const { instance, server, workspace } = await boot();
    const first = await server.createClaudeAgent(workspace.id);
    await server.createClaudeAgent(workspace.id);
    await server.createSession(workspace.id);

    const response = await server.delete(`/api/workspaces/${workspace.id}`);

    expect(response.status).toBe(204);
    expect(tmuxSessionNames(instance.config.tmuxSocket)).toEqual([]);
    expect(readdirSync(agentsRoot(instance.config.dataDir))).toEqual([]);
    const client = await server.openAgent(first.id);
    expect(await client.waitForClose()).toBe(4410);
  });

  it("comes back Stopped when its host goes down, and Restart resumes its conversation on the same log", async () => {
    const { instance, server, workspace } = await boot();
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();
    client.prompt("before");
    await client.waitForEntry(isResult, "the turn's result");

    killTmuxServer(instance.config.tmuxSocket);
    await pollUntil(
      async () => (await server.state()).workspaces[0]?.sessions[0]?.status === "stopped",
      { description: "the Agent to be Stopped" },
    );
    const restarted = await server.post(`/api/sessions/${session.id}/restart`);
    expect(restarted.status).toBe(200);

    const again = await server.openAgent(session.id);
    await again.sync();
    again.prompt("after");
    await again.waitForEntry(
      (entry) => entry.kind === "prompt" && entry.text === "after",
      "the new prompt",
    );
    await pollUntil(() => again.entries.filter(isResult).length === 2, {
      description: "the second turn's result",
    });
    // One log through both runs: the first run's prompt, its stop, the restart.
    expect(
      again.entries.map((e) =>
        e.kind === "runtime" ? `runtime ${e.event}` : e.kind === "prompt" ? e.text : "",
      ),
    ).toEqual(
      expect.arrayContaining(["runtime started", "before", "runtime stopped", "after"]),
    );
    expect(again.entries.map((entry) => entry.seq)).toEqual(
      again.entries.map((_, i) => i + 1),
    );
    // The second start carried on the conversation the first one began.
    const [first, second] = starts(instance.fakeClaude.received());
    const conversation = first?.argv
      .find((arg) => arg.startsWith("--session-id="))
      ?.split("=")[1];
    expect(conversation).toBeTruthy();
    expect(second?.argv).toContain(`--resume=${conversation}`);
  });

  it("is not created, and leaves nothing behind, when its Claude Code cannot start", async () => {
    const instance = createTestInstance({ claudeProgram: "/nonexistent/claude" });
    const server = await instance.start();
    const workspace = await server.createWorkspace({ folder: instance.makeFolder("p") });

    const response = await server.post(`/api/workspaces/${workspace.id}/sessions`, {
      interface: "agent",
    });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /^Claude Agent could not start: /,
    );
    expect((await server.state()).workspaces[0]?.sessions).toEqual([]);
    expect(tmuxSessionNames(instance.config.tmuxSocket)).toEqual([]);
    expect(readdirSync(agentsRoot(instance.config.dataDir))).toEqual([]);
  });
});
