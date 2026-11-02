import { describe, expect, it } from "vitest";
import {
  findOwnEntry,
  parseServeConfig,
  portUse,
  serveOffArgs,
  serveUrl,
} from "../scripts/tailscale-serve.ts";

// `tailscale serve status --json`, as Tailscale prints it, for three setups on one node:
// k-bench on 8443, a web service with two paths on 443, and a raw TCP forward on 5432.
const HOST = "my-mac.tail1234.ts.net";
const SHARED_HOST = `
{
  "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true }, "5432": { "TCPForward": "127.0.0.1:5432" } },
  "Web": {
    "${HOST}:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" }, "/files": { "Path": "/srv/files" } } },
    "${HOST}:8443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:7680" } } }
  }
}`;

describe("reading the tailscale serve configuration", () => {
  const config = parseServeConfig(SHARED_HOST);

  it("treats nothing configured as empty", () => {
    expect(parseServeConfig("{}").entries).toEqual([]);
    expect(parseServeConfig("").entries).toEqual([]);
  });

  it("finds k-bench's own entry on whichever port it is published", () => {
    expect(findOwnEntry(config, 7680)?.port).toBe(8443);
    expect(findOwnEntry(config, 7690)).toBeUndefined();
  });

  it("tells a free port, k-bench's own and somebody else's apart, whatever kind of service", () => {
    expect(portUse(config, 8443, 7680).kind).toBe("own");
    expect(portUse(config, 443, 7680).kind).toBe("other");
    expect(portUse(config, 5432, 7680).kind).toBe("other");
    expect(portUse(config, 10000, 7680).kind).toBe("free");
  });

  it("does not call k-bench's address 'own' when other paths share its port", () => {
    const shared = parseServeConfig(
      `{"TCP":{"443":{"HTTPS":true}},"Web":{"${HOST}:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7680"},"/api":{"Proxy":"http://127.0.0.1:9000"}}}}}`,
    );
    expect(portUse(shared, 443, 7680).kind).toBe("other");
  });

  it("describes what is on a port and how to switch it off", () => {
    const web = portUse(config, 443, 7680);
    const tcp = portUse(config, 5432, 7680);
    if (web.kind !== "other" || tcp.kind !== "other") throw new Error("expected others");
    expect(web.entry.targets.map((t) => t.description)).toEqual([
      "/ -> http://127.0.0.1:3000",
      "/files serves files",
    ]);
    expect(serveOffArgs(web.entry)).toEqual(["serve", "--https=443", "off"]);
    expect(serveOffArgs(tcp.entry)).toEqual(["serve", "--tcp=5432", "off"]);
  });

  it("builds the URL, leaving the port out only for 443", () => {
    expect(serveUrl(`${HOST}.`, 443)).toBe(`https://${HOST}/`);
    expect(serveUrl(HOST, 8443)).toBe(`https://${HOST}:8443/`);
  });
});
