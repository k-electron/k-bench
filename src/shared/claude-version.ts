/**
 * Whether the `claude` an Agent runs is older than the Claude Code its Agent SDK was made for
 * (the SDK's `claudeCodeVersion`, which the runtime reports in its hello). An older one can
 * silently ignore an option or refuse a flag the SDK sends, so k-bench warns; it never refuses
 * to start for it (see the Claude Agent guide).
 *
 * Compares `major.minor.patch` numerically, so 2.1.99 is older than 2.1.100. A version that
 * is not of that shape (`unknown`, say) gives no warning: a warning needs a certain answer.
 */
export function isOlderClaudeCode(running: string, expected: string): boolean {
  const a = parse(running);
  const b = parse(expected);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const [x, y] = [a[i] as number, b[i] as number];
    if (x !== y) return x < y;
  }
  return false;
}

function parse(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** The sentence the header shows for an older `claude`, or `undefined` when there is none. */
export function claudeVersionWarning(
  running: string,
  expected: string,
): string | undefined {
  return isOlderClaudeCode(running, expected)
    ? `This claude (${running}) is older than ${expected}, the version k-bench's Agent SDK was made for. Some things may not work; update claude.`
    : undefined;
}
