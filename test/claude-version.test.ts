import { describe, expect, it } from "vitest";
import { claudeVersionWarning } from "../src/shared/claude-version.ts";

// The browser derives the version warning from the runtime's hello with this function. Pure,
// and the one place a plain string comparison would get it wrong (2.1.99 against 2.1.100).

describe("the warning for an older claude", () => {
  it.each([
    { running: "2.1.99", expected: "2.1.100", warns: true },
    { running: "2.0.500", expected: "2.1.3", warns: true },
    { running: "2.1.327", expected: "2.1.327", warns: false },
    { running: "2.1.328", expected: "2.1.327", warns: false },
    { running: "2.1.1000", expected: "2.1.999", warns: false },
    { running: "3.0.0", expected: "2.9.9", warns: false },
    // A version it cannot read is no certain reason to warn.
    { running: "unknown", expected: "2.1.327", warns: false },
  ])("says so for $running against $expected: $warns", ({ running, expected, warns }) => {
    const warning = claudeVersionWarning(running, expected);

    expect(warning !== undefined).toBe(warns);
    if (warning) expect(warning).toContain(running);
  });
});
