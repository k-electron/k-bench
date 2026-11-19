/**
 * How a tool call reads in the Transcript: the target in `Bash(ls -la)`, the diff of an edit,
 * and the lines under the `⎿`. Pure functions of what Claude Code sent (the tool's input and
 * its result), so a display fix lands with the next page load. Tools not named here fall
 * through to a generic reading, which is why a new Claude Code tool still shows.
 *
 * `toolDiff` and `toolTarget` take only the tool's input, so the permission panel (#146) shows
 * the same diff and target before the tool has run.
 */

/** One line of a diff. `hunk` marks a gap between two changed regions. */
export interface DiffLine {
  kind: "add" | "del" | "context" | "hunk";
  text: string;
}

/** What goes under the `⎿` of a tool call. */
export interface ToolResultView {
  /** Claude Code's one-line reading of it ("Read 12 lines", "Updated x with 1 addition..."). */
  summary?: string;
  /** The tool's output, one per line, with the trailing blank lines dropped. */
  lines: string[];
}

/** What a tool call needs to know about where it ran. */
export interface ToolContext {
  /** Claude Code's working folder, to show paths relative to it. */
  cwd?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** `path` relative to `cwd` when it is inside it, as the terminal shows it. */
export function relativePath(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(`${cwd.replace(/\/$/, "")}/`)) {
    return path.slice(cwd.replace(/\/$/, "").length + 1);
  }
  return path;
}

const TARGET_LIMIT = 200;

function oneLine(value: string): string {
  const first = value.split("\n")[0] ?? "";
  return first.length > TARGET_LIMIT || first.length < value.length
    ? `${first.slice(0, TARGET_LIMIT)}…`
    : first;
}

/** What the tool acts on: the part in the parentheses of `Bash(ls -la)`. */
export function toolTarget(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext = {},
): string {
  const path = text(input.file_path) ?? text(input.notebook_path) ?? text(input.path);
  switch (name) {
    case "Bash":
      return oneLine(text(input.command) ?? "");
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return path ? relativePath(path, context.cwd) : "";
    case "Glob":
    case "Grep":
      return oneLine(text(input.pattern) ?? "");
    case "WebFetch":
      return oneLine(text(input.url) ?? "");
    case "WebSearch":
      return oneLine(text(input.query) ?? "");
    default: {
      if (path) return relativePath(path, context.cwd);
      for (const key of ["command", "pattern", "url", "query", "description", "prompt"]) {
        const value = text(input[key]);
        if (value) return oneLine(value);
      }
      return "";
    }
  }
}

/** The name as the terminal shows it: an MCP tool `mcp__server__tool` reads `server - tool (MCP)`. */
export function toolDisplayName(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp ? `${mcp[1]} - ${mcp[2]} (MCP)` : name;
}

/** The lines that differ between two texts: what only `before` has, then what only `after` has. */
function diffTexts(before: string, after: string): DiffLine[] {
  const was = before === "" ? [] : before.split("\n");
  const now = after === "" ? [] : after.split("\n");
  let start = 0;
  while (start < was.length && start < now.length && was[start] === now[start]) start++;
  let endWas = was.length;
  let endNow = now.length;
  while (endWas > start && endNow > start && was[endWas - 1] === now[endNow - 1]) {
    endWas--;
    endNow--;
  }
  return [
    ...was.slice(start, endWas).map((line): DiffLine => ({ kind: "del", text: line })),
    ...now.slice(start, endNow).map((line): DiffLine => ({ kind: "add", text: line })),
  ];
}

/** Claude Code's `structuredPatch` (a list of hunks of `+`, `-` and ` ` lines), as diff lines. */
function patchLines(patch: unknown[]): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const hunk of patch) {
    if (!isObject(hunk) || !Array.isArray(hunk.lines)) continue;
    if (lines.length > 0) lines.push({ kind: "hunk", text: "…" });
    for (const line of hunk.lines) {
      if (typeof line !== "string") continue;
      const body = line.slice(1);
      lines.push({
        kind: line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "context",
        text: body,
      });
    }
  }
  return lines;
}

/**
 * The diff of an edit, or undefined when the tool is not one: from Claude Code's own patch
 * when its result carries one (`structuredPatch`, with the lines around the change), else from
 * the tool's input (`Edit`'s `old_string` and `new_string`, `Write`'s `content` as all added).
 */
export function toolDiff(
  name: string,
  input: Record<string, unknown>,
  toolUseResult?: unknown,
): DiffLine[] | undefined {
  if (name !== "Edit" && name !== "MultiEdit" && name !== "Write") return undefined;
  if (isObject(toolUseResult) && Array.isArray(toolUseResult.structuredPatch)) {
    const lines = patchLines(toolUseResult.structuredPatch);
    if (lines.length > 0) return lines;
  }
  if (name === "Edit") {
    return diffTexts(text(input.old_string) ?? "", text(input.new_string) ?? "");
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    const lines: DiffLine[] = [];
    for (const edit of input.edits) {
      if (!isObject(edit)) continue;
      if (lines.length > 0) lines.push({ kind: "hunk", text: "…" });
      lines.push(...diffTexts(text(edit.old_string) ?? "", text(edit.new_string) ?? ""));
    }
    return lines;
  }
  if (name === "Write") return diffTexts("", text(input.content) ?? "");
  return undefined;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// Terminal colour codes in a command's output are not shown.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC starts every colour code
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** A tool result's content (a string, or blocks of text and images) as lines. */
export function contentLines(content: unknown): string[] {
  const all = Array.isArray(content)
    ? content
        .map((block) =>
          isObject(block) && block.type === "text"
            ? (text(block.text) ?? "")
            : isObject(block) && block.type === "image"
              ? "[image]"
              : "",
        )
        .join("\n")
    : (text(content) ?? "");
  const lines = all.replace(ANSI, "").split("\n");
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return lines.map((line) => line.replace(/\r$/, ""));
}

/** What goes under the `⎿` of a tool that ran and gave a result (not an error). */
export function toolResultView(
  name: string,
  input: Record<string, unknown>,
  content: unknown,
  toolUseResult: unknown,
  diff: DiffLine[] | undefined,
  context: ToolContext = {},
): ToolResultView {
  const lines = contentLines(content);
  const target = toolTarget(name, input, context);
  if (diff && (name === "Edit" || name === "MultiEdit")) {
    const added = diff.filter((line) => line.kind === "add").length;
    const removed = diff.filter((line) => line.kind === "del").length;
    return {
      summary: `Updated ${target} with ${plural(added, "addition")} and ${plural(removed, "removal")}`,
      lines: [],
    };
  }
  if (name === "Write") {
    const created = !isObject(toolUseResult) || toolUseResult.type !== "update";
    const written = (text(input.content) ?? "").split("\n").length;
    return {
      summary: `${created ? "Wrote" : "Updated"} ${plural(written, "line")} ${created ? "to" : "in"} ${target}`,
      lines: [],
    };
  }
  if (name === "Read") {
    const file = isObject(toolUseResult) ? toolUseResult.file : undefined;
    const counted = isObject(file) ? file.numLines : undefined;
    return {
      summary: `Read ${plural(typeof counted === "number" ? counted : lines.length, "line")}`,
      lines: [],
    };
  }
  return lines.length === 0 ? { summary: "(No content)", lines } : { lines };
}
