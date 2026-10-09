import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { loadWhatsOnTonight, type LoadTonightOpts } from "@/components/map/useWhatsOnTonight";
import { clearSurfaceCache, readSurfaceSnapshot } from "@/lib/surfaceDataCache";

let server: Server;
let origin: string;
let responses: ServerResponse[];
let closedBodies: number;

beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget());
  responses = [];
  closedBodies = 0;
  server = createServer((_request, response) => {
    responses.push(response);
    response.on("close", () => { closedBodies += 1; });
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"rows":');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  clearSurfaceCache();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.unstubAllGlobals();
});

it.each<[string, LoadTonightOpts, string]>([
  ["public", {}, "/api/whats-on?window=tonight&limit=60"],
  ["near", { near: { lat: 51.51, lng: -0.12 } }, "/api/whats-on?window=tonight&limit=60&near=51.51,-0.12"],
  ["pubOnly", { pubOnly: true }, "/api/whats-on?window=tonight&limit=60&pubOnly=1"],
  ["near pubOnly", { near: { lat: 51.51, lng: -0.12 }, pubOnly: true }, "/api/whats-on?window=tonight&limit=60&near=51.51,-0.12&pubOnly=1"],
])("cancels an unfinished %s listings body after headers when the last caller leaves", async (_label, options, url) => {
  const controller = new AbortController();
  const onResult = vi.fn();
  let receivedHeaders: (() => void) | undefined;
  const headers = new Promise<void>((resolve) => { receivedHeaders = resolve; });
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const response = await fetch(`${origin}${input}`, init);
    receivedHeaders?.();
    return response;
  });
  const pending = loadWhatsOnTonight({ ...options, fetchImpl, signal: controller.signal, onResult, timeoutMs: 10_000 });
  await headers;
  controller.abort();
  await pending;

  await vi.waitFor(() => expect(closedBodies).toBe(1), { timeout: 2_500 });
  expect(onResult).not.toHaveBeenCalled();
  expect(readSurfaceSnapshot(url)).toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("keeps the unfinished body alive while another caller still needs the shared answer", async () => {
  const controller = new AbortController();
  const onResult = vi.fn();
  let receivedHeaders: (() => void) | undefined;
  const headers = new Promise<void>((resolve) => { receivedHeaders = resolve; });
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const response = await fetch(`${origin}${input}`, init);
    receivedHeaders?.();
    return response;
  });
  const first = loadWhatsOnTonight({ fetchImpl, signal: controller.signal, onResult });
  await headers;
  const second = loadWhatsOnTonight({ fetchImpl });
  await Promise.resolve();
  controller.abort();
  await first;
  await new Promise<void>((resolve) => setTimeout(resolve, 1_100));
  expect(closedBodies).toBe(0);

  const response = responses[0];
  if (!response) throw new Error("Missing unfinished response");
  response.end(`[],"servedAt":"${new Date().toISOString()}","sourceObservedAt":"2026-10-07T09:00:00.000Z"}`);
  const result = await second;
  expect(result.status).toBe("empty");
  expect(result.sourceObservedAt).toBe("2026-10-07T09:00:00.000Z");
  expect(onResult).not.toHaveBeenCalled();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("times out unfinished bodies after headers and reports an outage after the bounded retry", async () => {
  let receivedHeaders = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const response = await fetch(`${origin}${input}`, init);
    receivedHeaders += 1;
    return response;
  });
  const result = await loadWhatsOnTonight({ fetchImpl, timeoutMs: 200 });
  expect(result.status).toBe("error");
  expect(result.rows).toEqual([]);
  expect(receivedHeaders).toBe(2);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(closedBodies).toBe(2));
  expect(readSurfaceSnapshot("/api/whats-on?window=tonight&limit=60")).toBeUndefined();
});
