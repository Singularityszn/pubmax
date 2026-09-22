import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync, constants } from "node:zlib";
import { expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) }));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
import { fetchHarvestResponse, fetchHarvestedPage } from "@/lib/harvest/robots";
import { fetchText } from "../scripts/harvest/uk-prices/run.mjs";
import { fetchBody } from "../scripts/backfill_site_harvest_drink_labels.mjs";
const url = "https://menu.example/menu";
const limit = 4 * 1024 * 1024;
const robots = async () => ({ allowed: true, reason: "allowed", evidence: "fixture" } as const);
let incoming: Readable;
function serve(bytes: Buffer, encoding?: string, type = "text/html") {
  network.request.mockImplementation((_url, _options, callback) => {
    incoming = Object.assign(Readable.from([bytes]), {
      headers: { "content-type": type, ...(encoding ? { "content-encoding": encoding } : {}) }, statusCode: 200,
    });
    return Object.assign(new EventEmitter(), { end: () => callback(incoming) });
  });
}
it.each([
  ["identity", (body: Buffer) => body], ["gzip", gzipSync], ["deflate", deflateSync], ["br", (body: Buffer) => brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } })],
] as const)("refuses oversized %s decoded bytes", async (encoding, compress) => {
  serve(compress(Buffer.alloc(limit + 1, 65)), encoding === "identity" ? undefined : encoding);
  await expect((await fetchHarvestResponse(url)).text().then(() => "accepted")).rejects.toThrow(/decoded body exceeds/);
  expect(incoming.destroyed).toBe(true);
});
it("accepts a body exactly at its byte ceiling", async () => {
  serve(gzipSync(Buffer.alloc(limit, 65)), "gzip");
  expect((await (await fetchHarvestResponse(url)).arrayBuffer()).byteLength).toBe(limit);
});
it("refuses a decoded PDF above its existing ceiling", async () => {
  serve(gzipSync(Buffer.alloc(12 * 1024 * 1024 + 1, 65)), "gzip", "application/pdf");
  await expect((await fetchHarvestResponse(url)).arrayBuffer().then(() => "accepted")).rejects.toThrow(/decoded body exceeds/);
});
it("preserves PDFs larger than the HTML ceiling", async () => {
  serve(gzipSync(Buffer.alloc(limit + 1, 65)), "gzip", "application/pdf");
  expect((await (await fetchHarvestResponse(url)).arrayBuffer()).byteLength).toBe(limit + 1);
});
it.each([["crawl", fetchText], ["backfill", fetchBody]] as const)("%s fails closed without partial prices", async (_name, read) => {
  serve(gzipSync(Buffer.alloc(limit + 1, 65)), "gzip");
  const result = await read(url, robots);
  expect(result.ok).toBe(false);
  expect(result.body.length).toBe(0);
});

it("propagates decoder errors", async () => {
  serve(Buffer.from("invalid gzip"), "gzip");
  await expect((await fetchHarvestResponse(url)).text()).rejects.toThrow();
});
it("consumer cancellation destroys the incoming stream", async () => {
  network.request.mockImplementation((_url, _options, callback) => {
    incoming = Object.assign(new Readable({ read() { this.push(Buffer.alloc(1024)); } }), {
      headers: {}, statusCode: 200,
    });
    return Object.assign(new EventEmitter(), { end: () => callback(incoming) });
  });
  const response = await fetchHarvestResponse(url);
  const closed = new Promise<void>((resolve) => incoming.once("close", resolve));
  await response.body!.cancel();
  await closed;
  expect(incoming.destroyed).toBe(true);
});
it.each([["crawler", fetchText], ["backfill", fetchBody]] as const)("%s refuses literal private addresses before requesting bytes", async (_name, read) => {
  network.request.mockClear();
  expect((await read("http://127.0.0.1/menu", robots)).ok).toBe(false);
  expect(network.request).not.toHaveBeenCalled();
});
it("rejects mixed DNS answers without dialing", async () => {
  network.request.mockClear();
  network.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await expect(fetchHarvestResponse(url)).rejects.toThrow(/address policy refused/);
  expect(network.request).not.toHaveBeenCalled();
});
it("pins socket resolution without a second DNS lookup", async () => {
  network.lookup.mockClear();
  network.request.mockClear();
  serve(Buffer.from("menu"));
  expect(await (await fetchHarvestResponse(url)).text()).toBe("menu");
  const socketLookup = network.request.mock.calls[0]![1].lookup;
  const callback = vi.fn();
  socketLookup("menu.example", {}, callback);
  socketLookup("menu.example", {}, callback);
  expect(callback).toHaveBeenLastCalledWith(null, "8.8.8.8", 4);
  expect(network.lookup).toHaveBeenCalledTimes(1);
});
it.each([["crawler", fetchText], ["backfill", fetchBody]] as const)("%s accepts bounded permitted pages", async (_name, read) => {
  serve(Buffer.from("permitted menu"));
  expect(await read(url, robots)).toMatchObject({ ok: true, body: "permitted menu" });
});
it("resolves and refuses a private DNS destination on a redirect before dialing it", async () => {
  network.request.mockClear();
  network.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
  network.lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  network.request.mockImplementation((_url, _options, callback) => {
    const response = Object.assign(Readable.from([]), {
      headers: { location: "https://rebound.example/menu" }, statusCode: 302,
    });
    return Object.assign(new EventEmitter(), { end: () => callback(response) });
  });
  await expect(fetchHarvestedPage(url, robots)).rejects.toThrow(/address policy refused/);
  expect(network.request).toHaveBeenCalledTimes(1);
});
