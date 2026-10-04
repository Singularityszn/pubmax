import { once } from "node:events";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";

import { createRobotsChecker } from "@/lib/harvest/robots";

it("refuses a private robots origin without reading its redirect destination", async () => {
  let privateReads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(302, { location: "/private-document" });
      response.end();
    } else {
      privateReads += 1;
      response.end("User-agent: *\nAllow: /");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address.");
    const result = await createRobotsChecker()(`http://127.0.0.1:${address.port}/menu`);
    expect({ allowed: result.allowed, privateReads }).toEqual({ allowed: false, privateReads: 0 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("refuses an oversized decoded robots file instead of trusting its prefix", async () => {
  const payload = gzipSync(Buffer.from("User-agent: *\nAllow: /\n#" + "x".repeat(512 * 1024)));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
    response.end(payload);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address.");
    const fetchImpl: typeof fetch = (_url, init) => fetch(`http://127.0.0.1:${address.port}/robots.txt`, init);
    const decision = await createRobotsChecker({ fetchImpl })("https://menu.example/menu");
    expect(decision.allowed).toBe(false);
    expect(decision.evidence).toContain("exceeds");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
