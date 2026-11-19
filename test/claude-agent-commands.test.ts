import { describe, expect, it } from "vitest";
import type { AgentCommands } from "../src/shared/agent-protocol.ts";
import { isResult } from "./harness/agent.ts";
import { bootWithWorkspace as boot } from "./harness/boot.ts";
import { pollUntil } from "./harness/poll.ts";

// Claude Code is the fake `claude`; the Agent Runtime and the Agent SDK are the real ones.

const COMMANDS = [
  {
    name: "compact",
    description: "Free up context",
    argumentHint: "[how]",
    builtin: true,
  },
  {
    name: "model",
    description: "Switch the model",
    argumentHint: "[name]",
    builtin: true,
  },
  { name: "exit", description: "Leave the terminal", argumentHint: "", builtin: true },
  { name: "review", description: "Review a change (a skill)", argumentHint: "" },
];

describe("the `/` menu's command list", () => {
  it("is what Claude Code lists, loses the terminal-only commands once a turn has said which they are, follows a replaced list, and reaches a client that joins later", async () => {
    const { instance, server, workspace } = await boot();
    const { fakeClaude } = instance;
    fakeClaude.configure({ commands: COMMANDS, terminalSlashCommands: ["exit"] });
    const session = await server.createClaudeAgent(workspace.id);
    const client = await server.openAgent(session.id);
    await client.sync();

    // Names, descriptions and hints travel as Claude Code gave them.
    const first = await client.waitForMessage(
      (m): m is AgentCommands => m.type === "commands",
      "the command list",
    );
    expect(first.commands.find((c) => c.name === "model")).toEqual({
      name: "model",
      description: "Switch the model",
      argumentHint: "[name]",
    });
    // Before any turn nothing says which commands are terminal-only (that is in each turn's
    // `init`), so all of them are offered.
    expect(client.commandNames).toEqual(["compact", "model", "exit", "review"]);

    client.prompt("hello");
    await client.waitForEntry(isResult, "the first turn's result");
    await pollUntil(() => !client.commandNames?.includes("exit"), {
      description: "the terminal-only command to leave the list",
    });
    expect(client.commandNames).toEqual(["compact", "model", "review"]);

    // Claude Code found another skill: its whole list replaces the last.
    fakeClaude.script([
      {
        system: {
          subtype: "commands_changed",
          commands: [
            ...COMMANDS,
            { name: "deploy", description: "Ship it", argumentHint: "<env>" },
          ],
        },
      },
    ]);
    client.prompt("look around");
    await pollUntil(() => client.commandNames?.includes("deploy"), {
      description: "the replaced list",
    });
    // The turn's own `init` had named `exit` terminal-only already: still hidden.
    expect(client.commandNames).toEqual(["compact", "model", "review", "deploy"]);

    const late = await server.openAgent(session.id);
    await late.sync();
    await pollUntil(() => late.commandNames !== undefined, {
      description: "the list for a client that joined late",
    });
    expect(late.commandNames).toEqual(["compact", "model", "review", "deploy"]);
  });
});
