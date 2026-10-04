import { once } from "node:events";
import { createServer, type RequestListener, type RequestOptions, type Server } from "node:http";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({
  lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]),
  destinations: [] as string[],
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:http", async (importOriginal) => {
  const http = await importOriginal<typeof import("node:http")>();
  return {
    ...http,
    // Keep production DNS checks and pinned lookup. Route only the test socket
    // to our local server, so no fixture can contact an external destination.
    request: (url: URL, options: RequestOptions, callback: Parameters<typeof http.request>[2]) => {
      options.lookup!(url.hostname, { all: false }, (_error, address) => {
        network.destinations.push(String(address));
      });
      const local = new URL(url);
      local.hostname = "127.0.0.1";
      return http.request(local, options, callback);
    },
  };
});

import { createRobotsChecker, fetchHarvestedPage, fetchHarvestResponse } from "@/lib/harvest/robots";

const servers: Server[] = [];
const allowed = async () => ({ allowed: true, reason: "allowed", evidence: "fixture" } as const);

beforeEach(() => {
  network.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  network.destinations.length = 0;
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function serve(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address.");
  return `http://menu.example:${address.port}`;
}

it("refuses mixed public/private DNS before contacting the local document", async () => {
  let reads = 0;
  const origin = await serve((_request, response) => {
    reads += 1;
    response.end("private document");
  });
  network.lookup.mockResolvedValueOnce([
    { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
  ]);
  await expect(fetchHarvestResponse(`${origin}/menu`)).rejects.toThrow(/address policy refused/);
  expect(reads).toBe(0);
});

it("uses the checked address without resolving again when the socket connects", async () => {
  const origin = await serve((_request, response) => response.end("permitted menu"));
  expect(await (await fetchHarvestResponse(`${origin}/menu`)).text()).toBe("permitted menu");
  expect(network.destinations).toEqual(["8.8.8.8"]);
  expect(network.lookup).toHaveBeenCalledTimes(1);
});

it("checks the redirected path's robots permission before requesting it", async () => {
  const paths: string[] = [];
  const origin = await serve((request, response) => {
    paths.push(request.url!);
    if (request.url === "/robots.txt") response.end("User-agent: *\nDisallow: /private");
    else if (request.url === "/start") {
      response.writeHead(302, { location: "/private" });
      response.end();
    } else response.end("private document");
  });
  expect(await fetchHarvestedPage(`${origin}/start`, createRobotsChecker())).toMatchObject({
    ok: false, reason: "robots-refused", url: `${origin}/private`,
  });
  expect(paths).toEqual(["/robots.txt", "/start"]);
});

it("refuses a redirected hostname whose DNS answer is private", async () => {
  let reads = 0;
  const origin = await serve((_request, response) => {
    reads += 1;
    response.writeHead(302, { location: `${origin.replace("menu.example", "rebound.example")}/private` });
    response.end();
  });
  network.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  await expect(fetchHarvestedPage(`${origin}/start`, allowed)).rejects.toThrow(/address policy refused/);
  expect(reads).toBe(1);
});

it("returns the permitted landing URL as provenance", async () => {
  const origin = await serve((request, response) => {
    if (request.url === "/start") {
      response.writeHead(302, { location: "/menu" });
      response.end();
    } else response.end("permitted menu");
  });
  const result = await fetchHarvestedPage(`${origin}/start`, allowed);
  expect(result).toMatchObject({ ok: true, url: `${origin}/menu` });
  if (!result.ok) throw new Error("Expected a permitted page.");
  expect(await result.response.text()).toBe("permitted menu");
});

it.each([
  ["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync],
] as const)("refuses %s bodies that exceed the decoded HTML limit", async (encoding, compress) => {
  const bytes = compress(Buffer.alloc(4 * 1024 * 1024 + 1, 65));
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "content-encoding": encoding });
    response.end(bytes);
  });
  await expect((await fetchHarvestResponse(`${origin}/menu`)).text()).rejects.toThrow(/decoded body exceeds/);
});

it("accepts a decoded HTML body at its exact byte limit", async () => {
  const bytes = gzipSync(Buffer.alloc(4 * 1024 * 1024, 65));
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    response.end(bytes);
  });
  expect((await (await fetchHarvestResponse(`${origin}/menu`)).arrayBuffer()).byteLength).toBe(4 * 1024 * 1024);
});

it("rejects a remote status outside the Response range without an uncaught exception", async () => {
  const origin = await serve((_request, response) => {
    response.writeHead(600);
    response.end("invalid status");
  });
  await expect(fetchHarvestResponse(`${origin}/menu`)).rejects.toThrow(/status 600 is unsupported/);
});

it("decodes stacked content encodings in reverse order for robots rules", async () => {
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "content-encoding": "GZip, BR" });
    response.end(brotliCompressSync(gzipSync(Buffer.from("User-agent: *\nDisallow: /private"))));
  });
  expect(await createRobotsChecker()(`${origin}/private`)).toMatchObject({ allowed: false, reason: "robots-disallowed" });
});

it("counts the fully decoded bytes of stacked content encodings", async () => {
  const bytes = brotliCompressSync(gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1, 65)));
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip, br" });
    response.end(bytes);
  });
  await expect((await fetchHarvestResponse(`${origin}/menu`)).text()).rejects.toThrow(/decoded body exceeds/);
});

it("refuses an unsupported content encoding instead of returning encoded bytes", async () => {
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-encoding": "gzip, unsupported" });
    response.end("encoded bytes");
  });
  await expect(fetchHarvestResponse(`${origin}/menu`)).rejects.toThrow(/content encoding.*unsupported/);
});

it("refuses more than four content encoding layers before decoding", async () => {
  let bytes = Buffer.from("permitted menu");
  for (let layer = 0; layer < 5; layer += 1) bytes = gzipSync(bytes);
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-encoding": "gzip, gzip, gzip, gzip, gzip" });
    response.end(bytes);
  });
  await expect(fetchHarvestResponse(`${origin}/menu`)).rejects.toThrow(/content encoding.*layers/);
});

it("accepts a body at the four-layer content encoding limit", async () => {
  let bytes = Buffer.from("permitted menu");
  for (let layer = 0; layer < 4; layer += 1) bytes = gzipSync(bytes);
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-encoding": "gzip, gzip, gzip, gzip" });
    response.end(bytes);
  });
  expect(await (await fetchHarvestResponse(`${origin}/menu`)).text()).toBe("permitted menu");
});

it("refuses a small header containing a thousand encoding layers", async () => {
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-encoding": Array(1_000).fill("gzip").join(",") });
    response.end("must not be decoded");
  });
  await expect(fetchHarvestResponse(`${origin}/menu`)).rejects.toThrow(/content encoding.*layers/);
});

it("preserves the PDF limit separately from HTML", async () => {
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "application/pdf", "content-encoding": "gzip" });
    response.end(gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1, 65)));
  });
  expect((await (await fetchHarvestResponse(`${origin}/menu.pdf`)).arrayBuffer()).byteLength).toBe(4 * 1024 * 1024 + 1);
});

it("refuses a PDF above its decoded byte limit", async () => {
  const bytes = gzipSync(Buffer.alloc(12 * 1024 * 1024 + 1, 65));
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "application/pdf", "content-encoding": "gzip" });
    response.end(bytes);
  });
  await expect((await fetchHarvestResponse(`${origin}/menu.pdf`)).arrayBuffer()).rejects.toThrow(/decoded body exceeds/);
});

it("refuses private redirect literals before contacting them", async () => {
  const paths: string[] = [];
  const origin = await serve((request, response) => {
    paths.push(request.url!);
    response.writeHead(302, { location: origin.replace("menu.example", "127.0.0.1") + "/private" });
    response.end();
  });
  expect(await fetchHarvestedPage(`${origin}/start`, allowed)).toMatchObject({ ok: false, reason: "source-policy" });
  expect(paths).toEqual(["/start"]);
});

it("bounds redirect loops", async () => {
  let reads = 0;
  const origin = await serve((_request, response) => {
    reads += 1;
    response.writeHead(302, { location: "/loop" });
    response.end();
  });
  expect(await fetchHarvestedPage(`${origin}/loop`, allowed)).toMatchObject({ ok: false, reason: "redirect-limit" });
  expect(reads).toBe(6);
});

it("returns no body for a HEAD request", async () => {
  const origin = await serve((_request, response) => response.end("not a HEAD body"));
  const response = await fetchHarvestResponse(`${origin}/menu`, { method: "HEAD" });
  expect(response.body).toBeNull();
});

it("refuses write requests and automatic redirects before resolving a host", async () => {
  await expect(fetchHarvestResponse("http://menu.example/menu", { method: "POST" })).rejects.toThrow(/GET\/HEAD/);
  await expect(fetchHarvestResponse("http://menu.example/menu", { redirect: "follow" })).rejects.toThrow(/automatic redirects/);
  expect(network.lookup).not.toHaveBeenCalled();
});

it("consumer cancellation closes an unfinished server response", async () => {
  let signalClosed!: () => void;
  const closed = new Promise<void>((resolve) => { signalClosed = resolve; });
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("still streaming");
    response.once("close", signalClosed);
  });
  const response = await fetchHarvestResponse(`${origin}/menu`);
  await response.body!.cancel();
  await closed;
});

it("caller abort closes an unfinished response", async () => {
  let signalClosed!: () => void;
  const closed = new Promise<void>((resolve) => { signalClosed = resolve; });
  const origin = await serve((_request, response) => {
    response.write("still streaming");
    response.once("close", signalClosed);
  });
  const controller = new AbortController();
  const response = await fetchHarvestResponse(`${origin}/menu`, { signal: controller.signal });
  const reading = response.text();
  controller.abort();
  await expect(reading).rejects.toThrow();
  await closed;
});

it("caller abort stops waiting for DNS and does not open a later socket", async () => {
  let resolveDns!: (addresses: { address: string; family: number }[]) => void;
  const lookupImpl = vi.fn(() => new Promise<{ address: string; family: number }[]>((resolve) => {
    resolveDns = resolve;
  }));
  const origin = await serve((_request, response) => response.end("must not be read"));
  const controller = new AbortController();
  const fetching = fetchHarvestResponse(`${origin}/menu`, { signal: controller.signal }, {
    lookupImpl: lookupImpl as unknown as typeof import("node:dns/promises").lookup,
  });
  const outcome = fetching.then(() => "accepted", () => "aborted");
  controller.abort();
  try {
    expect(await Promise.race([
      outcome, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 30)),
    ])).toBe("aborted");
  } finally {
    resolveDns([{ address: "8.8.8.8", family: 4 }]);
    await outcome;
  }
  expect(network.destinations).toEqual([]);
});

it("does not start robots checks for a pre-aborted page request", async () => {
  const robots = vi.fn(allowed);
  const controller = new AbortController();
  controller.abort();
  await expect(fetchHarvestedPage("http://menu.example/menu", robots, {
    signal: controller.signal,
  })).rejects.toThrow();
  expect(robots).not.toHaveBeenCalled();
  expect(network.lookup).not.toHaveBeenCalled();
});

it("aborts a pending robots wait without stopping another caller's shared check", async () => {
  const paths: string[] = [];
  let releaseRobots!: () => void;
  let startedRobots!: () => void;
  const started = new Promise<void>((resolve) => { startedRobots = resolve; });
  let robotsClosed = false;
  const origin = await serve((request, response) => {
    paths.push(request.url!);
    if (request.url === "/robots.txt") {
      response.once("close", () => { robotsClosed = true; });
      releaseRobots = () => response.end("User-agent: *\nAllow: /");
      startedRobots();
    } else response.end("permitted menu");
  });
  const robots = createRobotsChecker();
  const controller = new AbortController();
  const first = fetchHarvestedPage(`${origin}/first`, robots, { signal: controller.signal });
  const outcome = first.then(() => "accepted", () => "aborted");
  const other = fetchHarvestedPage(`${origin}/second`, robots);
  await started;
  controller.abort();
  try {
    expect(await Promise.race([
      outcome, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 30)),
    ])).toBe("aborted");
    expect(robotsClosed).toBe(false);
    expect(paths).toEqual(["/robots.txt"]);
  } finally {
    releaseRobots();
    await outcome;
    const result = await other;
    expect(result.ok).toBe(true);
    if (result.ok) expect(await result.response.text()).toBe("permitted menu");
  }
  expect(paths).toEqual(["/robots.txt", "/second"]);
});

it("checks cancellation before starting the next redirect hop", async () => {
  const controller = new AbortController();
  const robots = vi.fn(allowed);
  const fetchImpl = vi.fn(async () => {
    controller.abort();
    return new Response(null, { status: 302, headers: { location: "/next" } });
  });
  await expect(fetchHarvestedPage("http://menu.example/start", robots, {
    signal: controller.signal,
  }, { fetchImpl })).rejects.toThrow();
  expect(robots).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("handles a late robots rejection after its caller aborts", async () => {
  let rejectRobots!: (error: Error) => void;
  const robots = () => new Promise<Awaited<ReturnType<typeof allowed>>>((_resolve, reject) => {
    rejectRobots = reject;
  });
  const controller = new AbortController();
  const fetching = fetchHarvestedPage("http://menu.example/menu", robots, { signal: controller.signal });
  controller.abort();
  await expect(fetching).rejects.toThrow();
  rejectRobots(new Error("late robots error"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(network.lookup).not.toHaveBeenCalled();
});

it.each([false, true])("preserves credentials only for the original origin (cross-origin=%s)", async (crossOrigin) => {
  const received: { authorization?: string; cookie?: string }[] = [];
  const origin = await serve((request, response) => {
    received.push({ authorization: request.headers.authorization, cookie: request.headers.cookie });
    if (request.url === "/start") {
      response.writeHead(302, { location: `${crossOrigin ? origin.replace("menu.example", "other.example") : origin}/menu` });
      response.end();
    } else response.end("menu");
  });
  const result = await fetchHarvestedPage(`${origin}/start`, allowed, {
    headers: { authorization: "Bearer fixture", cookie: "fixture=yes" },
  });
  if (!result.ok) throw new Error("Expected a permitted page.");
  await result.response.text();
  expect(received).toEqual([
    { authorization: "Bearer fixture", cookie: "fixture=yes" },
    crossOrigin ? { authorization: undefined, cookie: undefined } : { authorization: "Bearer fixture", cookie: "fixture=yes" },
  ]);
});
