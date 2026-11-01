/** `base`, or `base (2)`, `base (3)`... for the first one `taken` does not hold. */
export function availableName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
