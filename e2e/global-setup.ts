import { execFileSync } from "node:child_process";

/** Builds the front end once per run; the tests then use the production build. */
export default function globalSetup(): void {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    stdio: "inherit",
  });
}
