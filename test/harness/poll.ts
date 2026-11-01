/**
 * Poll-until-timeout: the only way tests wait for an outcome. Never use fixed sleeps.
 * Resolves with the first truthy value `check` returns; rejects with `description` on timeout.
 */
export async function pollUntil<T>(
  check: () => T | Promise<T>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<NonNullable<T>> {
  const { timeoutMs = 10_000, intervalMs = 25, description = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
