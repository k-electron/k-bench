import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { AccessGuard } from "./access-guard.ts";
import { createApp } from "./app.ts";
import type { InstanceConfig } from "./config.ts";
import { EventSockets } from "./events.ts";
import { Service } from "./service.ts";
import { StateFeed } from "./state-feed.ts";
import { Store } from "./store.ts";
import { TerminalSockets } from "./terminal.ts";
import { TmuxDriver } from "./tmux.ts";

export interface ServerOptions {
  /** Folder holding the built front end to serve. Omit to serve the API only. */
  webDir?: string;
}

export interface RunningServer {
  port: number;
  /** Stops listening and releases the database. tmux, and so every Session, is untouched. */
  stop(): Promise<void>;
}

/** Boots a server for one instance config. Used by `main.ts` and by the test harness. */
export async function startServer(
  config: InstanceConfig,
  options: ServerOptions = {},
): Promise<RunningServer> {
  const store = new Store(config.dataDir);
  const tmux = new TmuxDriver(config.tmuxSocket);
  const service = new Service(store, tmux);
  // Anything on the socket that the store does not know is left over: clean it up first.
  await service.reconcile();
  const terminals = new TerminalSockets(service, tmux);
  const feed = new StateFeed(() => service.getState());
  const events = new EventSockets(feed);

  // The guard sits in front of everything the server answers, so no route or static file
  // (now or added later) can be reached without the allowed login.
  const guard = new AccessGuard(config.allowedLogin);
  const app = createApp(service, {
    webDir: options.webDir,
    pickerRoot: config.pickerRoot,
    onMutation: () => feed.notify(),
  });
  // Requests whose handlers are still running. A handler outlives its connection (closing
  // the sockets does not cancel it), so stopping waits for them before the database closes.
  const inFlight = new Set<Promise<unknown>>();
  const guarded = guard.wrapFetch(app.fetch);
  const server = serve({
    fetch: (request) => {
      const handled = Promise.resolve(guarded(request));
      inFlight.add(handled);
      const forget = () => inFlight.delete(handled);
      handled.then(forget, forget);
      return handled;
    },
    port: config.port,
    hostname: "127.0.0.1",
  }) as Server;
  server.on(
    "upgrade",
    guard.wrapUpgrade((request, socket, head) => {
      if (EventSockets.match(request)) {
        events.handleUpgrade(request, socket, head);
        return;
      }
      const sessionId = TerminalSockets.match(request);
      if (sessionId === undefined) {
        socket.destroy();
        return;
      }
      terminals.handleUpgrade(request, socket, head, sessionId);
    }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      events.closeAll();
      terminals.closeAll();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      // Nothing may read the database once it is closed: let in-flight reads finish first.
      await feed.close();
      await Promise.allSettled([...inFlight]);
      store.close();
    })();
    return stopping;
  };

  return { port: (server.address() as AddressInfo).port, stop };
}
