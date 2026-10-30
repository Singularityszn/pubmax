import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CRAWL_OFFLINE_PACK_MAX_STOPS,
  CRAWL_OFFLINE_PACK_MESSAGE,
  crawlOfflinePackMessage,
  requestCrawlOfflinePack,
} from "@/lib/crawlOfflinePack";

const ORIGIN = "https://pubmaxxing.com";
const PUB_CACHE = "pubmax-sw-crawl-pubs-v1-test";
const SWR_CACHE = "pubmax-sw-swr-test";

type Listener = (event: unknown) => void;

function pubPage(id: string, extraHead = ""): Response {
  return new Response(
    `<html><head>${extraHead}<link rel="stylesheet" href="/_next/static/css/pub.css"></head><body>${id}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", date: new Date().toUTCString() } },
  );
}

// A stylesheet the worker's isCacheable accepts: Node's Response reports type
// "default", which a browser never does for a same-origin fetch.
function stylesheet() {
  const headers = new Headers({ "content-type": "text/css" });
  const response = { ok: true, type: "basic" as const, headers, clone: () => response };
  return response;
}

/** The real public/sw.js over a Map-backed Cache Storage and a scripted fetch. */
function workerHarness(routes: Record<string, () => unknown>) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, unknown>>();
  const keyOf = (request: RequestInfo | URL, ignoreSearch = false) => {
    const url = new URL(typeof request === "string" ? request : "url" in request ? request.url : request.href, ORIGIN);
    if (ignoreSearch) url.search = "";
    return url.href;
  };
  const fakeCaches = {
    async open(name: string) {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      const entries = store;
      return {
        async match(request: RequestInfo, options?: { ignoreSearch?: boolean }) {
          return entries.get(keyOf(request, options?.ignoreSearch)) ?? undefined;
        },
        async put(request: RequestInfo, response: unknown) {
          const key = keyOf(request);
          entries.delete(key);
          entries.set(key, response);
        },
        async keys() {
          return [...entries.keys()].map((url) => new Request(url));
        },
        async delete(request: RequestInfo) {
          return entries.delete(keyOf(request));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const requests: Array<{ url: string; credentials?: string }> = [];
  const doFetch = vi.fn(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.url;
    requests.push({ url, credentials: typeof input === "string" ? undefined : input.credentials });
    const route = routes[new URL(url, ORIGIN).pathname];
    if (!route) throw new TypeError("offline");
    return route();
  });
  const fakeSelf = {
    location: { href: `${ORIGIN}/sw.js?v=test&cache-policy=plan-preview-safe-v2`, origin: ORIGIN },
    registration: { active: null, showNotification: vi.fn() },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  Function("self", "caches", "fetch", "importScripts", source)(
    fakeSelf,
    fakeCaches,
    doFetch,
    () => undefined,
  );
  return { listeners, stores, requests };
}

async function sendPack(listeners: Map<string, Listener>, data: unknown): Promise<void> {
  const lifetime: Promise<unknown>[] = [];
  listeners.get("message")!({
    data,
    waitUntil(value: Promise<unknown>) {
      lifetime.push(Promise.resolve(value));
    },
  });
  await Promise.all(lifetime);
}

async function navigate(listeners: Map<string, Listener>, url: string): Promise<Response> {
  const answer: { response?: Promise<unknown> } = {};
  listeners.get("fetch")!({
    request: { method: "GET", mode: "navigate", url },
    respondWith(value: Promise<unknown>) {
      answer.response = Promise.resolve(value);
    },
    waitUntil() {},
  });
  return (await answer.response) as Response;
}

describe("crawlOfflinePackMessage", () => {
  it("sends venue ids only, once each, up to the stop limit", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `venue-${index}`);
    const message = crawlOfflinePackMessage(["venue-a", "venue-a", "../admin", "", ...ids]);
    expect(message?.type).toBe(CRAWL_OFFLINE_PACK_MESSAGE);
    expect(message?.venueIds[0]).toBe("venue-a");
    expect(message?.venueIds).not.toContain("../admin");
    expect(message?.venueIds).toHaveLength(CRAWL_OFFLINE_PACK_MAX_STOPS);
  });

  it("sends nothing when no stop has a usable id", () => {
    expect(crawlOfflinePackMessage(["", "Venue A", "/pubs/x"])).toBeNull();
  });
});

describe("requestCrawlOfflinePack", () => {
  it("posts the pack to the controlling worker", () => {
    const postMessage = vi.fn();
    expect(requestCrawlOfflinePack(["venue-a"], { serviceWorker: { controller: { postMessage } } })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ["venue-a"] });
  });

  it("sends nothing with data saver on, or with no worker in control", () => {
    const postMessage = vi.fn();
    expect(requestCrawlOfflinePack(["venue-a"], {
      serviceWorker: { controller: { postMessage } },
      connection: { saveData: true },
    })).toBe(false);
    expect(requestCrawlOfflinePack(["venue-a"], { serviceWorker: { controller: null } })).toBe(false);
    expect(requestCrawlOfflinePack(["venue-a"], undefined)).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("service worker crawl offline pack", () => {
  it("saves each stop's pub page without cookies, with its stylesheet", async () => {
    const { listeners, stores, requests } = workerHarness({
      "/pubs/venue-a": () => pubPage("venue-a"),
      "/pubs/venue-b": () => pubPage("venue-b"),
      "/_next/static/css/pub.css": stylesheet,
    });
    await sendPack(listeners, { type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ["venue-a", "venue-b"] });

    expect([...stores.get(PUB_CACHE)!.keys()]).toEqual([
      `${ORIGIN}/pubs/venue-a`,
      `${ORIGIN}/pubs/venue-b`,
    ]);
    expect(requests.filter((request) => request.url.includes("/pubs/")).every(
      (request) => request.credentials === "omit",
    )).toBe(true);
    // One stylesheet shared by both pages is fetched once.
    expect(requests.filter((request) => request.url.endsWith(".css"))).toHaveLength(1);
    expect(stores.get(SWR_CACHE)!.has(`${ORIGIN}/_next/static/css/pub.css`)).toBe(true);
  });

  it("serves a saved stop when the network is gone", async () => {
    let online = true;
    const { listeners } = workerHarness({
      "/pubs/venue-a": () => {
        if (!online) throw new TypeError("offline");
        return pubPage("venue-a");
      },
    });
    // With nothing saved, an offline stop has no page to show.
    online = false;
    expect((await navigate(listeners, `${ORIGIN}/pubs/venue-a`)).status).toBe(503);

    online = true;
    await sendPack(listeners, { type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ["venue-a"] });
    online = false;
    const response = await navigate(listeners, `${ORIGIN}/pubs/venue-a?from=crawl`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("venue-a");
  });

  it("ignores any other message and any id that is not a venue id", async () => {
    const { listeners, stores, requests } = workerHarness({
      "/pubs/venue-a": () => pubPage("venue-a"),
    });
    await sendPack(listeners, { type: "something-else", venueIds: ["venue-a"] });
    await sendPack(listeners, { type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ["../admin", "a/b", 7] });
    await sendPack(listeners, "venue-a");
    expect(requests).toHaveLength(0);
    expect(stores.get(PUB_CACHE)?.size ?? 0).toBe(0);
  });

  it("does not save a redirect, an error or a page that is not HTML", async () => {
    const redirected = pubPage("moved");
    Object.defineProperty(redirected, "redirected", { value: true });
    const { listeners, stores } = workerHarness({
      "/pubs/venue-moved": () => redirected,
      "/pubs/venue-gone": () => new Response("gone", { status: 404, headers: { "content-type": "text/html" } }),
      "/pubs/venue-json": () => new Response("{}", { headers: { "content-type": "application/json" } }),
    });
    await sendPack(listeners, {
      type: CRAWL_OFFLINE_PACK_MESSAGE,
      venueIds: ["venue-moved", "venue-gone", "venue-json"],
    });
    expect(stores.get(PUB_CACHE)?.size ?? 0).toBe(0);
  });

  it("does not fetch a stop again while its saved page is fresh", async () => {
    const { listeners, requests } = workerHarness({ "/pubs/venue-a": () => pubPage("venue-a") });
    const message = { type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ["venue-a"] };
    await sendPack(listeners, message);
    await sendPack(listeners, message);
    expect(requests.filter((request) => request.url.endsWith("/pubs/venue-a"))).toHaveLength(1);
  });

  it("keeps the pack bounded", async () => {
    const routes: Record<string, () => Response> = {};
    for (let index = 0; index < 30; index += 1) routes[`/pubs/venue-${index}`] = () => pubPage(String(index));
    const { listeners, stores } = workerHarness(routes);
    for (let start = 0; start < 30; start += 10) {
      await sendPack(listeners, {
        type: CRAWL_OFFLINE_PACK_MESSAGE,
        venueIds: Array.from({ length: 10 }, (_, offset) => `venue-${start + offset}`),
      });
    }
    const saved = [...stores.get(PUB_CACHE)!.keys()];
    expect(saved).toHaveLength(24);
    // The oldest stops leave first.
    expect(saved[0]).toBe(`${ORIGIN}/pubs/venue-6`);
  });
});
