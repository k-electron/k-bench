import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import type { InstanceConfig } from "./config.ts";
import { Service } from "./service.ts";
import { Store } from "./store.ts";
import { TerminalSockets } from "./terminal.ts";
import { TmuxDriver } from "./tmux.ts";

export interface RunningServer {
  port: number;
  /** Stops listening and releases the database. tmux, and so every Session, is untouched. */
  stop(): Promise<void>;
}

/** Boots a server for one instance config. Used by `main.ts` and by the test harness. */
export async function startServer(config: InstanceConfig): Promise<RunningServer> {
  const store = new Store(config.dataDir);
  const tmux = new TmuxDriver(config.tmuxSocket);
  const service = new Service(store, tmux);
  const terminals = new TerminalSockets(service, tmux);

  const server = serve({
    fetch: createApp(service).fetch,
    port: config.port,
    hostname: "127.0.0.1",
  }) as Server;
  server.on("upgrade", (request, socket, head) => {
    const sessionId = TerminalSockets.match(request);
    if (sessionId === undefined) {
      socket.destroy();
      return;
    }
    terminals.handleUpgrade(request, socket, head, sessionId);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  return {
    port: (server.address() as AddressInfo).port,
    stop: async () => {
      terminals.closeAll();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      store.close();
    },
  };
}
