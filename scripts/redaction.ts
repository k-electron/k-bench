// What identifies the person or machine in a recording of a real Claude Code, and how to take
// it out. Shared by the two scripts that record a real `claude` by hand: the fake Claude's
// fixture recorder (scripts/record-fake-claude.ts) and the live check (scripts/live-check.ts).
// Neither is ever run by a test or in CI.
import { homedir } from "node:os";

export type Json = Record<string, unknown>;

const asJson = (value: unknown) => value as Json;

/**
 * Replaces what identifies the person or machine in a recorded value: folders (`folders` are
 * `[private, public]` pairs, tried before the generic rules), the home folder, any
 * `/Users/<name>` path, email addresses and signatures.
 */
export function redact(
  value: unknown,
  outDir: string,
  folders: ReadonlyArray<readonly [string, string]> = [],
): unknown {
  let text = JSON.stringify(value)
    .split(`${outDir}/work`)
    .join("/home/you/project")
    .split(outDir)
    .join("/home/you/recording");
  for (const [secret, replacement] of folders) {
    if (secret.length > 2) text = text.split(secret).join(replacement);
  }
  const json = text
    .split(homedir())
    .join("/home/you")
    .replace(/\/Users\/[^/"\\]+/g, "/home/you")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "you@example.com")
    .replace(/"signature":"[^"]+"/g, '"signature":"ZmFrZS1zaWduYXR1cmU="');
  return JSON.parse(json);
}

/** Empties the lists that hold the recorder's own plugins, skills, commands and servers. */
export function scrub(message: Json): Json {
  const copy = structuredClone(message);
  const reply = asJson(asJson(copy.response ?? {}).response ?? {});
  for (const target of [copy, reply]) {
    for (const key of ["plugins", "skills", "slash_commands", "agents", "mcp_servers"]) {
      if (key in target) target[key] = [];
    }
    for (const key of ["memory_paths", "messaging_socket_path"]) delete target[key];
    if (Array.isArray(target.commands)) {
      target.commands = (target.commands as Json[]).filter((c) => c.builtin);
    }
    if (Array.isArray(target.tools)) {
      target.tools = (target.tools as string[]).filter((t) => !t.startsWith("mcp__"));
    }
    if (Array.isArray(target.terminal_slash_commands)) {
      target.terminal_slash_commands = [];
    }
  }
  if (reply.account) {
    reply.account = {
      email: "you@example.com",
      organization: "Example Org",
      subscriptionType: "Claude Max",
      apiProvider: "firstParty",
    };
  }
  if ("pid" in reply) reply.pid = 4242;
  if (copy.type === "rate_limit_event") {
    copy.rate_limit_info = {
      status: "allowed",
      resetsAt: 1795048200,
      rateLimitType: "five_hour",
      isUsingOverage: false,
    };
  }
  return copy;
}
