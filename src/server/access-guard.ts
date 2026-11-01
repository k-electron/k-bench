import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/** The header `tailscale serve` adds to every request it proxies. */
export const LOGIN_HEADER = "tailscale-user-login";

const FORBIDDEN_BODY = "Forbidden\n";

/**
 * The access guard (ADR-0003): a request gets in only when its `Tailscale-User-Login` header
 * equals the instance's configured login exactly. A missing header, any other value, and an
 * unset (empty) configured login are all refused, so a misconfigured instance fails closed.
 */
export class AccessGuard {
  private readonly allowedLogin: string;

  constructor(allowedLogin: string) {
    this.allowedLogin = allowedLogin;
  }

  allows(login: string | null | undefined): boolean {
    return this.allowedLogin !== "" && login === this.allowedLogin;
  }

  /** Wraps a fetch handler so that it only ever sees allowed requests. */
  wrapFetch(
    fetch: (request: Request) => Response | Promise<Response>,
  ): (request: Request) => Response | Promise<Response> {
    return (request) =>
      this.allows(request.headers.get(LOGIN_HEADER))
        ? fetch(request)
        : new Response(FORBIDDEN_BODY, { status: 403 });
  }

  /** Wraps a WebSocket upgrade handler. A refused upgrade is answered with a plain 403. */
  wrapUpgrade(
    handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
    return (request, socket, head) => {
      const login = request.headers[LOGIN_HEADER];
      if (typeof login === "string" && this.allows(login)) {
        handler(request, socket, head);
        return;
      }
      socket.end(
        "HTTP/1.1 403 Forbidden\r\n" +
          "Content-Type: text/plain\r\n" +
          `Content-Length: ${FORBIDDEN_BODY.length}\r\n` +
          "Connection: close\r\n\r\n" +
          FORBIDDEN_BODY,
      );
    };
  }
}
