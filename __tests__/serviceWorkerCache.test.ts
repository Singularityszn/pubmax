import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: unknown) => void;

type FakeResponse = {
  ok: boolean;
  type: "cors" | "opaque";
  clone: ReturnType<typeof vi.fn>;
};

function workerHarness(input: {
  response?: FakeResponse;
  fetchError?: Error;
  cached?: FakeResponse | null;
  putError?: Error;
  trimError?: Error;
  activeWorker?: boolean;
  cacheNames?: string[];
}) {
  const listeners = new Map<string, Listener>();
  const put = vi.fn(async () => {
    if (input.putError) throw input.putError;
  });
  const cache = {
    match: vi.fn(async () => input.cached ?? null),
    put,
    keys: vi.fn(async () => {
      if (input.trimError) throw input.trimError;
      return [];
    }),
    delete: vi.fn(async () => true),
  };
  const fakeSelf = {
    location: {
      href: "https://pubmaxxing.com/sw.js?v=test",
      origin: "https://pubmaxxing.com",
    },
    registration: {
      active: input.activeWorker ? {} : null,
      showNotification: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const fakeCaches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => input.cacheNames ?? []),
    delete: vi.fn(async () => true),
  };
  const doFetch = vi.fn(async () => {
    if (input.fetchError) throw input.fetchError;
    return input.response;
  });
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  Function("self", "caches", "fetch", source)(fakeSelf, fakeCaches, doFetch);

  return { listeners, cache, put, doFetch, fakeCaches, fakeSelf };
}

function dispatchFetch(
  listener: Listener,
  request: Request,
): {
  response: Promise<unknown> | null;
  lifetime: Promise<unknown>[];
} {
  let response: Promise<unknown> | null = null;
  const lifetime: Promise<unknown>[] = [];
  listener({
    request,
    respondWith(value: Promise<unknown>) {
      response = Promise.resolve(value);
    },
    waitUntil(value: Promise<unknown>) {
      lifetime.push(Promise.resolve(value));
    },
  });
  return { response, lifetime };
}

function dispatchLifecycle(listener: Listener): Promise<unknown>[] {
  const lifetime: Promise<unknown>[] = [];
  listener({
    waitUntil(value: Promise<unknown>) {
      lifetime.push(Promise.resolve(value));
    },
  });
  return lifetime;
}

function fakeResponse(type: FakeResponse["type"], ok = true): FakeResponse {
  const clone = vi.fn();
  const response: FakeResponse = { ok, type, clone };
  clone.mockReturnValue(response);
  return response;
}

const TILE_URL =
  "https://tiles.openfreemap.org/planet/revision/11/1023/680.pbf";

describe("service worker map cache", () => {
  it("activates an update without leaving the broken worker in control", async () => {
    const { fakeSelf, listeners } = workerHarness({ activeWorker: true });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it("keeps first installation on the normal activation path", async () => {
    const { fakeSelf, listeners } = workerHarness({});

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("deletes every cache owned by superseded workers before claiming clients", async () => {
    const { fakeCaches, fakeSelf, listeners } = workerHarness({
      cacheNames: [
        "pubmax-sw-swr-broken",
        "pubmax-sw-shell-waiting",
        "pubmax-sw-swr-test",
        "unrelated-cache",
      ],
    });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeCaches.delete.mock.calls.map(([name]) => name)).toEqual([
      "pubmax-sw-swr-broken",
      "pubmax-sw-shell-waiting",
    ]);
    expect(fakeSelf.clients.claim).toHaveBeenCalledOnce();
  });

  it("returns a successful tile when Cache Storage rejects the write", async () => {
    const networkResponse = fakeResponse("cors");
    const { listeners, put } = workerHarness({
      response: networkResponse,
      putError: new DOMException("Storage quota exceeded", "QuotaExceededError"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    expect(event.response).not.toBeNull();
    await expect(event.response).resolves.toBe(networkResponse);
    expect(put).toHaveBeenCalledOnce();
  });

  it("returns successful static data when Cache Storage rejects the write", async () => {
    const networkResponse = fakeResponse("cors");
    const { listeners, put } = workerHarness({
      response: networkResponse,
      putError: new DOMException("Storage quota exceeded", "QuotaExceededError"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );

    await expect(event.response).resolves.toBe(networkResponse);
    expect(put).toHaveBeenCalledOnce();
  });

  it("returns a successful tile when cache trimming rejects", async () => {
    const networkResponse = fakeResponse("cors");
    const { listeners } = workerHarness({
      response: networkResponse,
      trimError: new DOMException("Cache read failed", "InvalidStateError"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    await expect(event.response).resolves.toBe(networkResponse);
    await expect(Promise.all(event.lifetime)).resolves.toEqual([undefined]);
  });

  it("intercepts cross-origin OpenFreeMap reads", () => {
    const { listeners } = workerHarness({ response: fakeResponse("cors") });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    expect(event.response).not.toBeNull();
  });

  it("passes an opaque network response through without caching it", async () => {
    const opaque = fakeResponse("opaque", false);
    const { listeners, put } = workerHarness({ response: opaque });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "no-cors" }),
    );

    await expect(event.response).resolves.toBe(opaque);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns an error response only when network and cache both miss", async () => {
    const { listeners } = workerHarness({
      fetchError: new TypeError("network unavailable"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );
    const response = (await event.response) as Response;

    expect(response.type).toBe("error");
    expect(response.status).toBe(0);
  });
});
