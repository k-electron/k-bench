// PROTOTYPE / live check spike — throwaway. Not k-bench code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

export const ROOT = `${path.dirname(new URL(import.meta.url).pathname)}/..`;
export const WORK = path.resolve(ROOT, "work");
export const OUT = path.resolve(ROOT, "out");
export const CLAUDE = path.join(os.homedir(), ".local/bin/claude");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

export function session(name, options = {}) {
  const queue = [];
  let wake = () => {};
  let closed = false;
  async function* input() {
    while (true) {
      while (queue.length) yield queue.shift();
      if (closed) return;
      await new Promise((r) => (wake = r));
    }
  }
  const q = query({
    prompt: input(),
    options: {
      pathToClaudeCodeExecutable: CLAUDE,
      cwd: WORK,
      model: "haiku",
      ...options,
    },
  });
  const log = fs.createWriteStream(path.join(OUT, `${name}.jsonl`), { flags: "a" });
  const msgs = [];
  let listeners = [];
  let ended = false;
  const done = (async () => {
    try {
      for await (const m of q) {
        log.write(`${JSON.stringify(m)}\n`);
        msgs.push(m);
        for (const l of listeners) l(m);
      }
    } catch (e) {
      log.write(`${JSON.stringify({ spike_error: String(e) })}\n`);
      msgs.push({ spike_error: String(e) });
    } finally {
      ended = true;
      for (const l of listeners) l(null);
    }
  })();

  function next(pred, timeoutMs = 180_000, from = msgs.length) {
    return new Promise((resolve) => {
      for (let i = from; i < msgs.length; i++) if (pred(msgs[i])) return resolve(msgs[i]);
      if (ended) return resolve(null);
      const t = setTimeout(() => {
        listeners = listeners.filter((x) => x !== l);
        resolve(null);
      }, timeoutMs);
      const l = (m) => {
        if (m === null || pred(m)) {
          clearTimeout(t);
          listeners = listeners.filter((x) => x !== l);
          resolve(m);
        }
      };
      listeners.push(l);
    });
  }

  return {
    q,
    msgs,
    next,
    send(text, extra = {}) {
      const from = msgs.length;
      queue.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        ...extra,
      });
      wake();
      return from;
    },
    async turn(text, extra = {}, timeoutMs) {
      const from = this.send(text, extra);
      const r = await next((m) => m.type === "result", timeoutMs, from);
      return { result: r, msgs: msgs.slice(from) };
    },
    async close() {
      closed = true;
      wake();
      await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
      try {
        q.close();
      } catch {}
      log.end();
    },
  };
}

export const init = (ms) => ms.filter((m) => m.type === "system" && m.subtype === "init");
export const text = (ms) =>
  ms
    .filter((m) => m.type === "assistant")
    .flatMap((m) => m.message.content.filter((b) => b.type === "text").map((b) => b.text))
    .join("\n");
export const toolUses = (ms) =>
  ms
    .filter((m) => m.type === "assistant")
    .flatMap((m) =>
      m.message.content.filter((b) => b.type === "tool_use").map((b) => b.name),
    );
