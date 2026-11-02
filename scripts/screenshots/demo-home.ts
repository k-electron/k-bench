// The made-up machine the screenshots are taken on: a fake home folder with three fictional
// projects under ~/code, and a shell set up so its prompt says nothing about the real one.
// Everything is written at run time into a temp folder, so no real path is ever committed.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";

export const HOME_ENV = "K_BENCH_SHOTS_HOME";

export const FAKE_USER = "alex";

const FILE_DATE = new Date("2026-10-02T11:05:00");

/** The folder name every run's fake home is created under, so a leak can be looked for. */
export const HOME_PREFIX = "kb-shots-";

export function createDemoHome(): string {
  // realpath: a Session's shell reports its folder by real path, and `~` only abbreviates
  // when the fake home is spelled the same way.
  const root = realpathSync(mkdtempSync(join(tmpdir(), HOME_PREFIX)));
  const home = join(root, "home");
  mkdirSync(join(home, "bin"), { recursive: true });
  seedShellConfig(home);
  seedAcmeApi(home);
  seedWebsite(home);
  seedDotfiles(home);
  fixDates(join(home, "code"));
  return home;
}

export function removeDemoHome(home: string): void {
  rmSync(dirname(home), { recursive: true, force: true });
}

function write(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
}

/**
 * Gives every file a fixed date, so a listing in a screenshot does not change from one run
 * to the next. Done last: version control would take a rewritten file of the same size and
 * date as unchanged.
 */
function fixDates(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) fixDates(path);
    utimesSync(path, FILE_DATE, FILE_DATE);
  }
}

/** A prompt with only the folder in it: never `%n` or `%m`, which are the real login and host. */
function seedShellConfig(home: string): void {
  write(
    join(home, ".zshrc"),
    [
      "unsetopt PROMPT_SP",
      "PROMPT_EOL_MARK=''",
      "HISTFILE=/dev/null",
      "SAVEHIST=0",
      'export PATH="$HOME/bin:$PATH" CLICOLOR=1',
      "PROMPT='%F{blue}%~%f %F{green}❯%f '",
      "",
    ].join("\n"),
  );
  write(join(home, ".zshenv"), "");
  const bash = [
    'export PATH="$HOME/bin:$PATH" CLICOLOR=1 HISTFILE=/dev/null',
    "PS1='\\[\\e[34m\\]\\w\\[\\e[0m\\] \\[\\e[32m\\]❯\\[\\e[0m\\] '",
    "",
  ].join("\n");
  write(join(home, ".bash_profile"), bash);
  write(join(home, ".bashrc"), bash);
  // A dev server that is obviously a stand-in: it prints a few made-up lines and waits.
  write(
    join(home, "bin", "dev-server"),
    `#!/bin/sh
printf '\\033[1mwebsite\\033[0m dev server\\n\\n'
printf '  Local:   \\033[36mhttp://localhost:3000/\\033[0m\\n'
printf '  Ready in 412 ms\\n\\n'
for line in 'GET /' 'GET /pricing' 'GET /docs/getting-started' 'GET /blog' 'GET /blog/launch-week' 'GET /about'; do
  printf '\\033[2m10:42:07\\033[0m %s \\033[32m200\\033[0m\\n' "$line"
done
exec sleep 100000
`,
    0o755,
  );
}

function seedAcmeApi(home: string): void {
  const dir = join(home, "code", "acme-api");
  write(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "acme-api", version: "1.4.0", scripts: { test: "vitest" } },
      null,
      2,
    ),
  );
  write(join(dir, "README.md"), "# acme-api\n\nOrders and invoices for Acme.\n");
  write(join(dir, "src", "index.ts"), "export const port = 8080;\n");
  write(join(dir, "src", "orders.ts"), "export function listOrders() { return []; }\n");
  write(
    join(dir, "src", "invoices.ts"),
    "export function listInvoices() { return []; }\n",
  );
  write(join(dir, "tests", "orders.test.ts"), "// orders\n");
  git(dir, "Add the orders endpoint", "2026-09-14T09:12:00");
  write(
    join(dir, "src", "invoices.ts"),
    "export function listInvoices() { return [1]; }\n",
  );
  git(dir, "Add invoices", "2026-09-21T15:40:00");
  write(join(dir, "src", "index.ts"), "export const port = 8081;\n");
  git(dir, "Move the API to port 8081", "2026-10-02T11:05:00");
}

function seedWebsite(home: string): void {
  const dir = join(home, "code", "website");
  write(
    join(dir, "package.json"),
    JSON.stringify({ name: "website", version: "0.3.0" }, null, 2),
  );
  write(join(dir, "index.html"), "<h1>Acme</h1>\n");
  write(join(dir, "pricing.html"), "<h1>Pricing</h1>\n");
  write(join(dir, "docs", "getting-started.md"), "# Getting started\n");
}

function seedDotfiles(home: string): void {
  const dir = join(home, "code", "dotfiles");
  write(join(dir, "zshrc"), "# my shell setup\n");
  write(join(dir, "gitconfig"), "[user]\n\tname = Alex Example\n");
  write(join(dir, "install.sh"), "#!/bin/sh\n# links the files above into ~\n");
}

/** Commits everything in `dir` as a made-up author, with a fixed date. */
function git(dir: string, message: string, date: string): void {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: dirname(dirname(dir)),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Alex Example",
    GIT_AUTHOR_EMAIL: "alex@example.com",
    GIT_COMMITTER_NAME: "Alex Example",
    GIT_COMMITTER_EMAIL: "alex@example.com",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  const run = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env, stdio: "ignore" });
  run("init", "-q", "-b", "main");
  run("add", "-A");
  run("commit", "-q", "-m", message);
}

/**
 * The environment the Sessions' shells get: the fake home, a made-up login, and a PATH of
 * system folders plus the one holding this node (so the recording player can run).
 */
export function demoShellEnv(home: string): Record<string, string> {
  const shell = userInfo().shell ?? "/bin/zsh";
  if (!["zsh", "bash"].includes(basename(shell))) {
    throw new Error(
      `The screenshots set up a zsh or bash prompt, but your login shell is ${shell}`,
    );
  }
  return {
    HOME: home,
    USER: FAKE_USER,
    LOGNAME: FAKE_USER,
    SHELL: shell,
    LANG: "en_US.UTF-8",
    PATH: [
      join(home, "bin"),
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      dirname(process.execPath),
    ].join(":"),
  };
}
