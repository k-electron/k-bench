import { WebSocket } from "ws";
import { pollUntil } from "./poll.ts";

/** A client of the events WebSocket: collects the state snapshots the server pushes. */
export class EventsClient<State> {
  private readonly socket: WebSocket;
  /** Every snapshot received so far, oldest first. */
  readonly snapshots: State[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data: Buffer) => {
      this.snapshots.push(JSON.parse(data.toString()) as State);
    });
  }

  static async open<State>(
    baseUrl: string,
    headers: Record<string, string> = {},
  ): Promise<EventsClient<State>> {
    const url = new URL("/api/events", baseUrl);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers });
    const client = new EventsClient<State>(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        reject(new Error(`events upgrade refused with HTTP ${response.statusCode}`));
      });
      socket.once("error", reject);
    });
    return client;
  }

  get latest(): State | undefined {
    return this.snapshots.at(-1);
  }

  /**
   * Waits for a snapshot, arriving from now on or already received, that satisfies
   * `matches`, and returns it.
   */
  async waitForSnapshot(
    matches: (state: State) => boolean,
    description = "a matching state snapshot",
  ): Promise<State> {
    return pollUntil(() => this.snapshots.find(matches), {
      description: `${description}; last snapshot was:\n${JSON.stringify(this.latest, null, 1)}`,
    });
  }

  close(): void {
    this.socket.close();
  }
}
