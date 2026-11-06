import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Everything that differs between the Installed instance, the Dev instance and tests. */
export interface InstanceConfig {
  /** Folder holding the SQLite database. */
  dataDir: string;
  /** tmux socket name (`tmux -L <name>`). */
  tmuxSocket: string;
  /** Port to listen on, always bound to 127.0.0.1. 0 picks a free port. */
  port: number;
  /** The only tailnet login allowed in. */
  allowedLogin: string;
  /** Folder the folder picker starts at. */
  pickerRoot: string;
  /**
   * The program a Claude Session runs as Claude Code: a name resolved through the owner's
   * login shell, or a path. It exists so tests can point it at a stub; it is not a setting.
   */
  claudeProgram: string;
}

const PRESETS = {
  installed: {
    dataDir: join(homedir(), "Library", "Application Support", "k-bench"),
    tmuxSocket: "k-bench",
    port: 7680,
  },
  dev: {
    dataDir: resolve(".data"),
    tmuxSocket: "k-bench-dev",
    port: 7690,
  },
} as const;

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `K_BENCH_PORT must be a whole number from 1 to 65535, got "${value}"`,
    );
  }
  return port;
}

/**
 * Resolves the instance config. `K_BENCH_INSTANCE` picks the preset (`installed` or `dev`,
 * default `dev`, so a stray run can never touch the Installed instance); each value can be
 * overridden by its own variable.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): InstanceConfig {
  const name = env.K_BENCH_INSTANCE ?? "dev";
  if (name !== "installed" && name !== "dev") {
    throw new Error(`K_BENCH_INSTANCE must be "installed" or "dev", got "${name}"`);
  }
  const preset = PRESETS[name];
  return {
    dataDir: resolve(env.K_BENCH_DATA_DIR ?? preset.dataDir),
    tmuxSocket: env.K_BENCH_TMUX_SOCKET ?? preset.tmuxSocket,
    port: parsePort(env.K_BENCH_PORT) ?? preset.port,
    allowedLogin: env.K_BENCH_ALLOWED_LOGIN ?? "",
    pickerRoot: resolve(env.K_BENCH_PICKER_ROOT ?? homedir()),
    claudeProgram: "claude",
  };
}
