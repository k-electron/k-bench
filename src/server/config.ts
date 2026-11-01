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
    port: env.K_BENCH_PORT ? Number(env.K_BENCH_PORT) : preset.port,
    allowedLogin: env.K_BENCH_ALLOWED_LOGIN ?? "",
    pickerRoot: resolve(env.K_BENCH_PICKER_ROOT ?? homedir()),
  };
}
