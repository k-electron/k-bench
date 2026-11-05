// Reading the tailnet's `tailscale serve` configuration, shared by the `k-bench` commands:
// install checks that its HTTPS port is free, uninstall removes only k-bench's own entry,
// status prints where k-bench is reachable. The parsing is pure (`parseServeConfig` and the
// functions after it take plain data); `readServeConfig` is the one thin call to the CLI.
//
// The input is `tailscale serve status --json`, whose shape (confirmed against Tailscale
// itself) is, for k-bench published on the default port:
//
//   { "TCP": { "443": { "HTTPS": true } },
//     "Web": { "<host>.<tailnet>.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:7680" } } } } }
//
// `Web` is keyed `<host>:<port>`; a handler is a `Proxy` (a URL), a `Path` (files), a `Text`
// or a `Redirect`. A raw TCP forward lives only under `TCP`, as `{ "TCPForward": "host:port" }`.
// Nothing configured prints `{}`.
import { execFileSync } from "node:child_process";

/** The HTTPS port k-bench is published on unless `--https-port` says otherwise. */
export const DEFAULT_HTTPS_PORT = 443;

/** One thing `tailscale serve` publishes on one port. */
export interface ServeEntry {
  /** The tailnet port it listens on. */
  port: number;
  /** `web` for HTTP(S) handlers, `tcp` for a raw TCP forward. */
  kind: "web" | "tcp";
  /** What each URL path (or the TCP port) goes to, e.g. `/ -> http://127.0.0.1:3000`. */
  targets: ServeTarget[];
}

export interface ServeTarget {
  /** The URL path a web handler serves, `/` for the root; absent for a TCP forward. */
  path?: string;
  /** The local URL it proxies to, when it is a proxy. */
  proxy?: string;
  /** A short human description, e.g. `/ -> http://127.0.0.1:3000` or `/ serves files`. */
  description: string;
}

export interface ServeConfig {
  entries: ServeEntry[];
}

interface RawServeConfig {
  TCP?: Record<string, { TCPForward?: string }>;
  Web?: Record<
    string,
    {
      Handlers?: Record<
        string,
        { Proxy?: string; Path?: string; Text?: string; Redirect?: string }
      >;
    }
  >;
}

function describeHandler(
  path: string,
  handler: { Proxy?: string; Path?: string; Text?: string; Redirect?: string },
): ServeTarget {
  if (handler.Proxy !== undefined) {
    return { path, proxy: handler.Proxy, description: `${path} -> ${handler.Proxy}` };
  }
  if (handler.Path !== undefined) return { path, description: `${path} serves files` };
  if (handler.Redirect !== undefined) {
    return { path, description: `${path} redirects to ${handler.Redirect}` };
  }
  return { path, description: `${path} serves a fixed response` };
}

/**
 * Reads the output of `tailscale serve status --json`. Throws when it isn't JSON; nothing
 * configured (`{}` or no output) is an empty configuration.
 */
export function parseServeConfig(json: string): ServeConfig {
  const text = json.trim();
  const raw: RawServeConfig = text === "" ? {} : JSON.parse(text);
  const entries: ServeEntry[] = [];
  const webPorts = new Set<number>();

  for (const [hostPort, web] of Object.entries(raw.Web ?? {})) {
    const port = Number(hostPort.slice(hostPort.lastIndexOf(":") + 1));
    if (!Number.isInteger(port)) continue;
    webPorts.add(port);
    const targets = Object.entries(web.Handlers ?? {}).map(([path, handler]) =>
      describeHandler(path, handler),
    );
    entries.push({ port, kind: "web", targets });
  }

  // A TCP port with a web entry is that entry's listener; any other is a raw forward.
  for (const [portText, tcp] of Object.entries(raw.TCP ?? {})) {
    const port = Number(portText);
    if (!Number.isInteger(port) || webPorts.has(port)) continue;
    entries.push({
      port,
      kind: "tcp",
      targets: [
        {
          description: tcp.TCPForward
            ? `TCP forward to ${tcp.TCPForward}`
            : "a TCP listener",
        },
      ],
    });
  }
  return { entries };
}

/** The local address k-bench's server listens on, which its own entry proxies to. */
export function kBenchLocalUrl(localPort: number): string {
  return `http://127.0.0.1:${localPort}`;
}

/**
 * The arguments that publish k-bench's server on `httpsPort`. Built from `kBenchLocalUrl`,
 * so the entry they make is one that `findOwnEntries` recognises and uninstall can remove.
 */
export function servePublishArgs(httpsPort: number, localPort: number): string[] {
  return ["serve", "--bg", `--https=${httpsPort}`, kBenchLocalUrl(localPort)];
}

function isKBenchProxy(proxy: string | undefined, localPort: number): boolean {
  if (proxy === undefined) return false;
  const normalised = proxy.replace(/\/+$/, "").replace("://localhost:", "://127.0.0.1:");
  return normalised === kBenchLocalUrl(localPort);
}

/**
 * Whether an entry is k-bench's own: a web entry whose only handler is `/` proxying to
 * k-bench's local address (`localPort`, 7680 for the Installed instance). An entry that also
 * serves other paths is somebody else's setup that k-bench shares a port with.
 */
function isOwnEntry(entry: ServeEntry, localPort: number): boolean {
  return (
    entry.kind === "web" &&
    entry.targets.length === 1 &&
    entry.targets[0]?.path === "/" &&
    isKBenchProxy(entry.targets[0].proxy, localPort)
  );
}

/** Every one of k-bench's own entries, one per port it is published on. */
export function findOwnEntries(config: ServeConfig, localPort: number): ServeEntry[] {
  return config.entries.filter((entry) => isOwnEntry(entry, localPort));
}

/** The first of k-bench's own entries, on whichever port; undefined when not published. */
export function findOwnEntry(
  config: ServeConfig,
  localPort: number,
): ServeEntry | undefined {
  return findOwnEntries(config, localPort)[0];
}

/** What is published on `port`: nothing, k-bench's own entry, or something else. */
export type PortUse =
  | { kind: "free" }
  | { kind: "own"; entry: ServeEntry }
  | { kind: "other"; entry: ServeEntry };

export function portUse(config: ServeConfig, port: number, localPort: number): PortUse {
  const onPort = config.entries.filter((entry) => entry.port === port);
  const [first] = onPort;
  if (!first) return { kind: "free" };
  const foreign = onPort.find((entry) => !isOwnEntry(entry, localPort));
  return foreign ? { kind: "other", entry: foreign } : { kind: "own", entry: first };
}

/** The URL a device on the tailnet opens: the port is left out when it is the default. */
export function serveUrl(dnsName: string, port: number): string {
  return `https://${dnsName.replace(/\.$/, "")}${port === DEFAULT_HTTPS_PORT ? "" : `:${port}`}/`;
}

/**
 * The arguments that remove an entry (`tailscale serve --https=<port> off`, or `--tcp=` for
 * a raw forward), for replacing it (`install --force`) or removing k-bench's own (uninstall).
 */
export function serveOffArgs(entry: ServeEntry): string[] {
  return ["serve", `--${entry.kind === "tcp" ? "tcp" : "https"}=${entry.port}`, "off"];
}

/**
 * Asks Tailscale what it is serving. Throws a readable error when the CLI fails (for
 * example Tailscale isn't running) or answers with something that isn't the expected JSON.
 */
export function readServeConfig(tailscale: string): ServeConfig {
  let output: string;
  try {
    output = execFileSync(tailscale, ["serve", "status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim();
    throw new Error(
      `could not read the tailscale serve configuration (\`tailscale serve status --json\` failed${detail ? `: ${detail}` : ""}). Is Tailscale running?`,
    );
  }
  try {
    return parseServeConfig(output);
  } catch {
    throw new Error(
      "could not read the tailscale serve configuration: `tailscale serve status --json` did not print JSON.",
    );
  }
}
