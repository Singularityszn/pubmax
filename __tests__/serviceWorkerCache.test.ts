import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAP_DOCUMENT_QUERY_KEYS } from "@/lib/mapDocumentTwin";

type Listener = (event: unknown) => void;

type FakeResponse = {
  ok: boolean;
  type: "cors" | "opaque";
  headers?: { get: (name: string) => string | null };
  json?: ReturnType<typeof vi.fn>;
  clone: ReturnType<typeof vi.fn>;
};

function workerHarness(input: {
  response?: FakeResponse;
  fetchError?: Error;
  cached?: FakeResponse | null;
  putError?: Error;
  trimError?: Error;
  activeWorker?: string;
  cacheNames?: string[];
  workerPolicy?: string;
  workerVersion?: string;
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
      href:
        `https://pubmaxxing.com/sw.js?v=${input.workerVersion ?? "test"}&cache-policy=${input.workerPolicy ?? "plan-preview-safe-v2"}`,
      origin: "https://pubmaxxing.com",
    },
    registration: {
      active: input.activeWorker
        ? { scriptURL: input.activeWorker }
        : null,
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

function rolloutWorkerHarness(input: {
  entries: Record<string, Array<[string, Response]>>;
  rejectCurrentWrites?: boolean;
  rejectDeletes?: boolean;
  importError?: Error;
  response?: Response;
}) {
  const listeners = new Map<string, Listener>();
  const records = new Map<
    string,
    Map<string, { request: Request; response: Response }>
  >();
  for (const [name, entries] of Object.entries(input.entries)) {
    records.set(
      name,
      new Map(
        entries.map(([url, response]) => {
          const request = new Request(
            new URL(url, "https://pubmaxxing.com"),
          );
          return [request.url, { request, response }];
        }),
      ),
    );
  }
  const deletedCaches: string[] = [];
  const fakeCaches = {
    async open(name: string) {
      let entries = records.get(name);
      if (!entries) {
        entries = new Map();
        records.set(name, entries);
      }
      return {
        async match(request: RequestInfo, options?: CacheQueryOptions) {
          const url = new URL(
            typeof request === "string" ? request : request.url,
            "https://pubmaxxing.com",
          );
          if (!options?.ignoreSearch) return entries.get(url.href)?.response;
          for (const entry of entries.values()) {
            const candidate = new URL(entry.request.url);
            if (
              candidate.origin === url.origin &&
              candidate.pathname === url.pathname
            ) {
              return entry.response;
            }
          }
          return undefined;
        },
        async put(request: RequestInfo, response: Response) {
          if (
            input.rejectCurrentWrites &&
            name.endsWith("-target")
          ) {
            throw new DOMException(
              "Storage quota exceeded",
              "QuotaExceededError",
            );
          }
          const storedRequest = new Request(
            typeof request === "string"
              ? new URL(request, "https://pubmaxxing.com")
              : request,
          );
          entries.set(storedRequest.url, {
            request: storedRequest,
            response,
          });
        },
        async keys() {
          return [...entries.values()].map(({ request }) => request);
        },
        async delete(request: RequestInfo) {
          if (input.rejectDeletes) return false;
          const url = new URL(
            typeof request === "string" ? request : request.url,
            "https://pubmaxxing.com",
          );
          return entries.delete(url.href);
        },
      };
    },
    async keys() {
      return [...records.keys()];
    },
    async delete(name: string) {
      if (input.rejectDeletes) return false;
      deletedCaches.push(name);
      return records.delete(name);
    },
  };
  const fakeSelf = {
    caches: fakeCaches,
    location: {
      href:
        "https://pubmaxxing.com/sw.js?v=target&cache-policy=plan-preview-safe-v2",
      origin: "https://pubmaxxing.com",
    },
    registration: {
      active: {
        scriptURL: "https://pubmaxxing.com/sw.js?v=legacy-active",
      },
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
  const doFetch = vi.fn(async () => {
    if (input.response) return input.response;
    throw new TypeError("network unavailable");
  });
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const importScripts = vi.fn(() => {
    if (input.importError) throw input.importError;
    const planCacheSource = readFileSync(
      join(process.cwd(), "public", "sw-plan-cache.js"),
      "utf8",
    );
    Function("self", planCacheSource)(fakeSelf);
  });
  Function("self", "caches", "fetch", "importScripts", source)(
    fakeSelf,
    fakeCaches,
    doFetch,
    importScripts,
  );

  return {
    deletedCaches,
    fakeCaches,
    fakeSelf,
    importScripts,
    listeners,
    records,
  };
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

function fakeResponse(type: FakeResponse["type"], ok = true, cacheControl?: string): FakeResponse {
  const clone = vi.fn();
  const response: FakeResponse = {
    ok,
    type,
    ...(cacheControl ? { headers: { get: () => cacheControl } } : {}),
    json: vi.fn(async () => ({ revision: "test", rows: [] })),
    clone,
  };
  clone.mockReturnValue(response);
  return response;
}

const TILE_URL =
  "https://tiles.openfreemap.org/planet/revision/11/1023/680.pbf";

describe("service worker map cache", () => {
  it("activates over a pre-fix worker without leaving it in control", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker: "https://pubmaxxing.com/sw.js?v=legacy-active",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it("activates over an explicitly marked pre-fix worker", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=legacy-active&cache-policy=cache-write-coupled-v1",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it("activates over the old write-safe worker that could cache private anchors", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=previous&cache-policy=write-safe-v1",
    });

    await Promise.all(dispatchLifecycle(listeners.get("install")!));

    expect(fakeSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it("keeps later privacy-safe updates on the normal waiting path", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=previous&cache-policy=plan-preview-safe-v2",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("does not serve a cached manifest requested for another deployment revision", async () => {
    const manifest = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ version: 2, shards: [] })),
    };
    manifest.clone.mockReturnValue(manifest);
    const { listeners } = workerHarness({ cached: manifest, fetchError: new Error("offline") });
    const request = new Request(
      "https://pubmaxxing.com/data/venues_slim.manifest.json?v=other-deploy",
    );
    const dispatched = dispatchFetch(listeners.get("fetch")!, request);

    const response = await dispatched.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not serve a stale cached London monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners } = workerHarness({
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(
        "https://pubmaxxing.com/data/venues_slim.json?v=test",
      ),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not let a previous worker serve its London monolith to a new deployment", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners, put } = workerHarness({
      workerVersion: "previous",
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=target"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("serves a matching cached London monolith while offline", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "test", rows: [] });
    const { listeners } = workerHarness({
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=test"),
    );

    await expect(event.response).resolves.toBe(monolith);
  });

  it("does not serve a stale cached city monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners } = workerHarness({
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(
        "https://pubmaxxing.com/data/cities/manchester/venues_slim.json?v=test",
      ),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not cache a stale network London monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners, put } = workerHarness({ response: monolith });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=test"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("returns and caches a current network London monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "test", rows: [] });
    const { listeners, put } = workerHarness({ response: monolith });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=test"),
    );

    await expect(event.response).resolves.toBe(monolith);
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).toHaveBeenCalledOnce();
  });

  it("returns a fresh manifest when deployment revisions differ", async () => {
    const manifest = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ version: 2, revision: "other-deploy", shards: [] })),
    };
    manifest.clone.mockReturnValue(manifest);
    const { listeners } = workerHarness({ response: manifest });
    const request = new Request(
      "https://pubmaxxing.com/data/venues_slim.manifest.json?v=other-deploy",
    );
    const dispatched = dispatchFetch(listeners.get("fetch")!, request);

    const response = await dispatched.response;
    expect(response).toBe(manifest);
  });

  it("rejects and does not cache a network shard from another revision", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "stale-deploy", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners, put } = workerHarness({ response: shard });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json?v=other-deploy"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("does not serve an unversioned cached venue shard", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "test", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("serves a current-revision cached venue shard", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "test", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json?v=test"),
    );

    await expect(event.response).resolves.toBe(shard);
  });

  it("serves an unversioned cached venue shard for local builds", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "local", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      workerVersion: "local",
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );

    await expect(event.response).resolves.toBe(shard);
  });

  it("does not serve a prior-revision cached venue shard", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "previous", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json?v=test"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not force takeover for future privacy-safe policy changes", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=previous&cache-policy=plan-preview-safe-v2",
      workerPolicy: "plan-preview-safe-v3",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("keeps first installation on the normal activation path", async () => {
    const { fakeSelf, listeners } = workerHarness({});

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("purges old tiles but preserves usable offline caches when migration writes fail", async () => {
    const shellResponse = new Response("offline landing");
    const dataResponse = new Response("legacy data");
    const staticResponse = new Response("legacy static");
    const planResponse = new Response("legacy plan");
    const {
      deletedCaches,
      fakeCaches,
      fakeSelf,
      importScripts,
      listeners,
      records,
    } =
      rolloutWorkerHarness({
        rejectCurrentWrites: true,
        entries: {
          "pubmax-sw-shell-legacy-active": [
            ["/", shellResponse],
            ["/map", new Response("older map document")],
            ["/p/legacy-drop", new Response("legacy Pint Drop")],
          ],
          "pubmax-sw-data-legacy-active": [
            ["/data/venues_slim.core.json", dataResponse],
          ],
          "pubmax-sw-swr-legacy-active": [
            [TILE_URL, new Response("poisoned", { status: 503 })],
            ["/_next/static/chunks/legacy.js", staticResponse],
          ],
          "pubmax-sw-preview-plan-v2-legacy-active": [
            ["/plan/offline-night", planResponse],
            ["/p/legacy-drop", new Response("legacy Pint Drop")],
          ],
          "unrelated-cache": [["/unrelated", new Response("unrelated")]],
        },
      });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(deletedCaches).toEqual([]);
    expect(
      records.get("pubmax-sw-swr-legacy-active")?.has(TILE_URL),
    ).toBe(false);
    expect(
      records
        .get("pubmax-sw-swr-legacy-active")
        ?.has("https://pubmaxxing.com/_next/static/chunks/legacy.js"),
    ).toBe(true);
    expect(records.has("pubmax-sw-shell-legacy-active")).toBe(true);
    expect(records.get("pubmax-sw-shell-legacy-active")
      ?.has("https://pubmaxxing.com/p/legacy-drop")).toBe(false);
    expect(records.get("pubmax-sw-shell-legacy-active")
      ?.has("https://pubmaxxing.com/map")).toBe(false);
    expect(records.has("pubmax-sw-data-legacy-active")).toBe(true);
    expect(records.has("pubmax-sw-preview-plan-v2-legacy-active")).toBe(true);
    expect(
      records.get("pubmax-sw-preview-plan-v2-legacy-active")
        ?.has("https://pubmaxxing.com/p/legacy-drop"),
    ).toBe(false);
    expect(records.has("unrelated-cache")).toBe(true);
    expect(fakeSelf.clients.claim).toHaveBeenCalledOnce();

    const navigation = dispatchFetch(
      listeners.get("fetch")!,
      {
        method: "GET",
        mode: "navigate",
        url: "https://pubmaxxing.com/map",
      } as Request,
    );
    await expect(navigation.response).resolves.toBe(shellResponse);
    expect(await fakeCaches.keys()).toContain(
      "pubmax-sw-shell-legacy-active",
    );

    const planNavigation = dispatchFetch(
      listeners.get("fetch")!,
      {
        method: "GET",
        mode: "navigate",
        url: "https://pubmaxxing.com/plan/offline-night",
      } as Request,
    );
    await expect(planNavigation.response).resolves.toBe(planResponse);
    expect(importScripts).toHaveBeenCalledWith("/sw-plan-cache.js?v=target");
  });

  it.each([
    { importFails: false, rejectCurrentWrites: false },
    { importFails: false, rejectCurrentWrites: true },
    { importFails: true, rejectCurrentWrites: false },
    { importFails: true, rejectCurrentWrites: true },
  ])("preserves public offline pages and excludes private HTML with $importFails import failure and $rejectCurrentWrites write rejection", async ({ importFails, rejectCurrentWrites }) => {
    const origin = "https://pubmaxxing.com";
    const home = new Response("landing shell");
    const currentPlan = new Response("current public preview");
    const legacyPlan = new Response("legacy public preview");
    const shells: Array<[string, Response]> = [
      ["/", home],
      ["/map", new Response("map shell")],
      ["/tonight", new Response("tonight shell")],
      ["/offline.html", new Response("offline shell")],
    ];
    const olderMapDocument: [string, Response] = ["/map", new Response("older map document")];
    const privatePaths = ["/p/drop1", "/plan/night1/recap"];
    const excluded: Array<[string, Response]> = [
      ...privatePaths.map((path): [string, Response] => [path, new Response("private HTML")]),
      ["https://foreign.example/plan/current", new Response("foreign HTML")],
    ];
    const { listeners, records, importScripts, fakeSelf } = rolloutWorkerHarness({
      rejectCurrentWrites,
      importError: importFails ? new Error("helper unavailable") : undefined,
      entries: {
        "pubmax-sw-preview-plan-v2-target": [["/plan/current?old=1", currentPlan], ...excluded],
        "pubmax-sw-preview-plan-v2-legacy-active": [["/plan/legacy?old=1", legacyPlan], ...excluded],
        "pubmax-sw-shell-target": [...shells.slice(0, 2), ...excluded],
        "pubmax-sw-shell-legacy-active": [...shells.slice(2), olderMapDocument, ...excluded],
      },
    });
    expect(importScripts).toHaveBeenCalledOnce();
    if (importFails) expect(importScripts).toHaveReturnedTimes(0);

    for (const phase of ["before activation", "after activation"]) {
      if (phase === "after activation") {
        await Promise.all(dispatchLifecycle(listeners.get("activate")!));
        expect(fakeSelf.clients.claim).toHaveBeenCalledOnce();
      }
      for (const [path, expected] of [
        ["/plan/current?new=2", currentPlan],
        ["/plan/legacy?new=2", legacyPlan],
        ...shells,
        ...privatePaths.map((path): [string, Response] => [path, home]),
        ["https://foreign.example/plan/current", home],
        ["/plan/never-cached", home],
      ] as Array<[string, Response]>) {
        const navigation = dispatchFetch(listeners.get("fetch")!, {
          method: "GET",
          mode: "navigate",
          url: new URL(path, origin).href,
        } as Request);
        expect(await navigation.response, `${phase}: ${path}`).toBe(expected);
      }
    }

    expect([...records.get("pubmax-sw-preview-plan-v2-target")!.keys()]).toEqual([
      `${origin}/plan/current?old=1`,
      ...(rejectCurrentWrites ? [] : [`${origin}/plan/legacy?old=1`]),
    ]);
    expect([...(records.get("pubmax-sw-preview-plan-v2-legacy-active")?.keys() ?? [])]).toEqual(
      rejectCurrentWrites ? [`${origin}/plan/legacy?old=1`] : [],
    );
    expect([...records.get("pubmax-sw-shell-target")!.keys()]).toEqual(
      (rejectCurrentWrites ? shells.slice(0, 2) : shells).map(([path]) => `${origin}${path}`),
    );
    expect([...(records.get("pubmax-sw-shell-legacy-active")?.keys() ?? [])]).toEqual(
      (rejectCurrentWrites ? shells.slice(2) : []).map(([path]) => `${origin}${path}`),
    );
  });

  it.each([
    { importFails: false, rejectCurrentWrites: false },
    { importFails: false, rejectCurrentWrites: true },
    { importFails: true, rejectCurrentWrites: false },
    { importFails: true, rejectCurrentWrites: true },
  ])("keeps navigation admission private with $importFails import failure and $rejectCurrentWrites write rejection", async ({ importFails, rejectCurrentWrites }) => {
    const live = new Response("live HTML");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {},
      response: live,
      rejectCurrentWrites,
      importError: importFails ? new Error("helper unavailable") : undefined,
    });
    for (const path of ["/p/drop1", "/plan/night1/recap", "https://foreign.example/plan/night1"]) {
      const navigation = dispatchFetch(listeners.get("fetch")!, {
        method: "GET",
        mode: "navigate",
        url: new URL(path, "https://pubmaxxing.com").href,
      } as Request);
      expect(await navigation.response).toBe(live);
      await Promise.all(navigation.lifetime);
    }
    expect(records.size).toBe(0);

    const plan = dispatchFetch(listeners.get("fetch")!, {
      method: "GET",
      mode: "navigate",
      url: "https://pubmaxxing.com/plan/night1?first=1",
    } as Request);
    expect(await plan.response).toBe(live);
    await Promise.all(plan.lifetime);
    expect([...(records.get("pubmax-sw-preview-plan-v2-target")?.keys() ?? [])]).toEqual(
      importFails || rejectCurrentWrites ? [] : ["https://pubmaxxing.com/plan/night1"],
    );
  });

  it("purges Pint Drops and private plan subpages from current and legacy plan caches", async () => {
    const planResponse = new Response("offline plan preview");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-preview-plan-v2-target": [
          ["/p/current-drop", new Response("current Pint Drop")],
          ["/plan/current/recap", new Response("current private recap")],
        ],
        "pubmax-sw-preview-plan-v2-legacy-active": [
          ["/p/legacy-drop", new Response("legacy Pint Drop")],
          ["/plan/legacy/recap", new Response("legacy private recap")],
          ["/plan/offline-night", planResponse],
        ],
      },
    });

    await Promise.all(dispatchLifecycle(listeners.get("activate")!));

    const current = records.get("pubmax-sw-preview-plan-v2-target");
    expect([...current!.keys()]).toEqual([
      "https://pubmaxxing.com/plan/offline-night",
    ]);
    expect(
      [...(records.get("pubmax-sw-preview-plan-v2-legacy-active")?.keys() ?? [])]
        .some((url) => url.includes("/p/") || url.includes("/recap")),
    ).toBe(false);

    for (const path of ["/p/current-drop", "/p/legacy-drop", "/plan/legacy/recap"]) {
      const navigation = dispatchFetch(
        listeners.get("fetch")!,
        { method: "GET", mode: "navigate", url: `https://pubmaxxing.com${path}` } as Request,
      );
      expect((await navigation.response as Response).status).toBe(503);
    }
    const plan = dispatchFetch(
      listeners.get("fetch")!,
      { method: "GET", mode: "navigate", url: "https://pubmaxxing.com/plan/offline-night" } as Request,
    );
    expect(await plan.response).toBe(planResponse);
  });

  it("purges an invalid current plan-cache entry without a legacy cache", async () => {
    const { listeners, records } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-preview-plan-v2-target": [
          ["/p/old-drop", new Response("old Pint Drop")],
          ["/plan/offline-night", new Response("offline plan preview")],
        ],
      },
    });

    await Promise.all(dispatchLifecycle(listeners.get("activate")!));

    expect([...records.get("pubmax-sw-preview-plan-v2-target")!.keys()]).toEqual([
      "https://pubmaxxing.com/plan/offline-night",
    ]);
  });

  it("never serves a Pint Drop from a shell cache before activation", async () => {
    const { listeners } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-shell-target": [
          ["/p/current-drop", new Response("cached Pint Drop")],
        ],
        "pubmax-sw-shell-legacy-active": [
          ["/p/legacy-drop", new Response("old Pint Drop")],
        ],
      },
    });

    for (const path of ["/p/current-drop", "/p/legacy-drop"]) {
      const navigation = dispatchFetch(
        listeners.get("fetch")!,
        { method: "GET", mode: "navigate", url: `https://pubmaxxing.com${path}` } as Request,
      );
      expect((await navigation.response as Response).status).toBe(503);
    }
  });

  it("does not admit a network Pint Drop into shell or plan caches", async () => {
    const pintDrop = new Response("live Pint Drop");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {},
      response: pintDrop,
    });
    const navigation = dispatchFetch(
      listeners.get("fetch")!,
      { method: "GET", mode: "navigate", url: "https://pubmaxxing.com/p/live-drop" } as Request,
    );

    expect(await navigation.response).toBe(pintDrop);
    await Promise.all(navigation.lifetime);
    expect(records.get("pubmax-sw-shell-target")?.size ?? 0).toBe(0);
    expect(records.get("pubmax-sw-preview-plan-v2-target")?.size ?? 0).toBe(0);
  });

  it("purges Pint Drops and older map documents from current and legacy shell caches on activation", async () => {
    const mapResponse = new Response("older map document");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-shell-target": [
          ["/p/current-drop", new Response("current Pint Drop")],
        ],
        "pubmax-sw-shell-legacy-active": [
          ["/p/legacy-drop", new Response("legacy Pint Drop")],
          ["/map", mapResponse],
        ],
      },
    });

    await Promise.all(dispatchLifecycle(listeners.get("activate")!));

    expect([...records.get("pubmax-sw-shell-target")!.keys()]).toEqual([]);
    expect(records.has("pubmax-sw-shell-legacy-active")).toBe(false);

    const map = dispatchFetch(
      listeners.get("fetch")!,
      { method: "GET", mode: "navigate", url: "https://pubmaxxing.com/map" } as Request,
    );
    const served = await map.response as Response;
    expect(served).not.toBe(mapResponse);
    expect(served.status).toBe(503);
  });

  it("migrates shell entries without promoting old stable data", async () => {
    const { deletedCaches, fakeSelf, listeners, records } =
      rolloutWorkerHarness({
        entries: {
          "pubmax-sw-shell-legacy-active": [
            ["/tonight", new Response("offline tonight")],
            ["/map", new Response("older map document")],
          ],
          "pubmax-sw-data-legacy-active": [
            ["/data/venues_slim.core.json", new Response("legacy data")],
          ],
        },
      });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(deletedCaches).toEqual(["pubmax-sw-shell-legacy-active"]);
    expect([...records.get("pubmax-sw-shell-target")!.keys()]).toEqual([
      "https://pubmaxxing.com/tonight",
    ]);
    expect(
      records
        .get("pubmax-sw-data-target")
        ?.has("https://pubmaxxing.com/data/venues_slim.core.json"),
    ).toBe(false);
    expect(records.has("pubmax-sw-data-legacy-active")).toBe(true);
    expect(fakeSelf.clients.claim).toHaveBeenCalledOnce();
  });

  it("does not use old stable data after current cache and network miss", async () => {
    const oldData = new Response("legacy data");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-data-legacy-active": [
          ["/data/venues_slim.core.json", oldData],
        ],
      },
    });

    const activation = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(activation)).resolves.toBeDefined();
    expect(
      records
        .get("pubmax-sw-data-target")
        ?.has("https://pubmaxxing.com/data/venues_slim.core.json"),
    ).toBe(false);

    const data = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );
    const response = (await data.response) as Response;
    expect(response.type).toBe("error");
    expect(response).not.toBe(oldData);
  });

  it("does not serve an incompatible venue manifest from an old cache", async () => {
    const legacyManifest = new Response(
      JSON.stringify({
        version: 1,
        shards: [{ url: "/data/venues_slim.borough.json" }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    const { listeners } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-data-legacy-active": [
          ["/data/venues_slim.manifest.json", legacyManifest],
        ],
      },
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.manifest.json"),
    );
    const response = (await event.response) as Response;

    expect(response.type).toBe("error");
    expect(response.status).toBe(0);
  });

  it("prefers fresh network data over an old stable-data fallback", async () => {
    const oldData = new Response(JSON.stringify({ revision: "legacy", rows: [] }));
    const freshData = new Response(JSON.stringify({ revision: "target", rows: [] }));
    Object.defineProperty(freshData, "type", { value: "basic" });
    const { listeners, records } = rolloutWorkerHarness({
      response: freshData,
      entries: {
        "pubmax-sw-data-legacy-active": [
          ["/data/venues_slim.core.json", oldData],
        ],
      },
    });

    const activation = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(activation)).resolves.toBeDefined();

    const data = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );
    await expect(data.response).resolves.toBe(freshData);
    await expect(Promise.all(data.lifetime)).resolves.toBeDefined();
    const stored = records
      .get("pubmax-sw-data-target")
      ?.get("https://pubmaxxing.com/data/venues_slim.core.json")
      ?.response;
    expect(await stored?.text()).toBe(JSON.stringify({ revision: "target", rows: [] }));
    expect(records.has("pubmax-sw-data-legacy-active")).toBe(false);
  });

  it("does not serve a poisoned OpenFreeMap entry retained in an old cache", async () => {
    const poisoned = new Response("poisoned", { status: 503 });
    const { listeners } = rolloutWorkerHarness({
      rejectCurrentWrites: true,
      entries: {
        "pubmax-sw-swr-legacy-active": [
          [TILE_URL, poisoned],
          ["/_next/static/chunks/legacy.js", new Response("legacy static")],
        ],
      },
    });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    const tile = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );
    const response = (await tile.response) as Response;
    expect(response.type).toBe("error");
    expect(response).not.toBe(poisoned);
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

  it("does not cache a tile when its host forbids storage", async () => {
    const networkResponse = fakeResponse("cors", true, "no-store");
    const { listeners, put } = workerHarness({ response: networkResponse });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    await expect(event.response).resolves.toBe(networkResponse);
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
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

describe("map shell versus per-request map documents", () => {
  const origin = "https://pubmaxxing.com";
  const shell = () => new Response("prerendered map shell");

  async function navigateOnline(path: string, live: Response) {
    const { listeners, records } = rolloutWorkerHarness({
      entries: { "pubmax-sw-shell-target": [["/map", shell()]] },
      response: live,
    });
    const navigation = dispatchFetch(listeners.get("fetch")!, {
      method: "GET",
      mode: "navigate",
      url: new URL(path, origin).href,
    } as Request);
    expect(await navigation.response).toBe(live);
    await Promise.all(navigation.lifetime);
    return records.get("pubmax-sw-shell-target")!.get(`${origin}/map`)?.response.text();
  }

  it.each(MAP_DOCUMENT_QUERY_KEYS.flatMap((key) => [`/map?${key}=camden`, `/map?drink=wine&${key}=%20x%20`]))(
    "keeps the shell when %s renders its own document",
    async (path) => {
      const twin = new Response("per-request map document", {
        headers: { "cache-control": "private, no-store" },
      });
      expect(await navigateOnline(path, twin)).toBe("prerendered map shell");
    },
  );

  it.each(["/map", "/map?drink=wine", "/map?place=%20%20", "/map?place=&place=camden", "/map?sel=venue-1"])(
    "refreshes the shell from %s, which the prerendered document answers",
    async (path) => {
      expect(await navigateOnline(path, new Response("fresh map shell"))).toBe("fresh map shell");
    },
  );

  it.each(["private, no-store", "no-store", "no-cache", "private", 'private="set-cookie", max-age=60'])(
    "keeps the shell when a navigation answers with Cache-Control %s",
    async (cacheControl) => {
      const live = new Response("uncacheable map document", { headers: { "cache-control": cacheControl } });
      expect(await navigateOnline("/map", live)).toBe("prerendered map shell");
    },
  );

  it("refreshes the shell from a public document the CDN revalidates", async () => {
    const live = new Response("revalidated map shell", {
      headers: { "cache-control": "public, max-age=0, must-revalidate" },
    });
    expect(await navigateOnline("/map", live)).toBe("revalidated map shell");
  });

  it("returns the live shell document and settles its lifetime when Cache Storage rejects the write", async () => {
    const live = new Response("live map shell");
    const { listeners } = rolloutWorkerHarness({ entries: {}, response: live, rejectCurrentWrites: true });
    const navigation = dispatchFetch(listeners.get("fetch")!, {
      method: "GET",
      mode: "navigate",
      url: `${origin}/map`,
    } as Request);
    expect(await navigation.response).toBe(live);
    await expect(Promise.all(navigation.lifetime)).resolves.toBeDefined();
  });

  it.each([
    ["public, max-age=0, must-revalidate", ["/", "/map", "/tonight", "/offline.html"]],
    ["private, no-cache, no-store, max-age=0, must-revalidate", []],
  ] as const)("precaches shells answered with Cache-Control %s only when storable", async (cacheControl, stored) => {
    const { listeners, records } = rolloutWorkerHarness({
      entries: {},
      response: new Response("installed shell", { headers: { "cache-control": cacheControl } }),
    });
    await Promise.all(dispatchLifecycle(listeners.get("install")!));
    expect([...(records.get("pubmax-sw-shell-target")?.keys() ?? [])]).toEqual(stored.map((path) => `${origin}${path}`));
  });

  it.each([
    { rejectDeletes: false, rejectCurrentWrites: false },
    { rejectDeletes: true, rejectCurrentWrites: false },
    { rejectDeletes: false, rejectCurrentWrites: true },
    { rejectDeletes: true, rejectCurrentWrites: true },
  ])("never serves or inherits a stored shell that forbids storing itself (deletes rejected: $rejectDeletes, writes rejected: $rejectCurrentWrites)", async ({ rejectDeletes, rejectCurrentWrites }) => {
    const restricted = (marker: string) => new Response(marker, { headers: { "cache-control": "private, no-store" } });
    const landing = new Response("public landing shell");
    const legacyLanding = new Response("older public landing shell");
    const { listeners, records } = rolloutWorkerHarness({
      rejectDeletes,
      rejectCurrentWrites,
      entries: {
        "pubmax-sw-shell-target": [
          ["/", landing],
          ["/tonight", restricted("current restricted tonight")],
        ],
        "pubmax-sw-shell-legacy-active": [
          ["/", legacyLanding],
          ["/tonight", restricted("older restricted tonight")],
          ["/offline.html", restricted("older restricted offline page")],
        ],
      },
    });
    for (const phase of ["before activation", "after activation"]) {
      if (phase === "after activation") await Promise.all(dispatchLifecycle(listeners.get("activate")!));
      for (const path of ["/tonight", "/offline.html", "/p/never-cached"]) {
        const navigation = dispatchFetch(listeners.get("fetch")!, {
          method: "GET",
          mode: "navigate",
          url: `${origin}${path}`,
        } as Request);
        expect(await (await navigation.response as Response).clone().text(), `${phase}: ${path}`).toBe("public landing shell");
      }
    }
    const current = records.get("pubmax-sw-shell-target")!;
    const kept = await Promise.all([...current.values()].map(({ response }) => response.clone().text()));
    expect(kept).not.toContain("older restricted tonight");
    expect(kept).not.toContain("older restricted offline page");
    if (!rejectDeletes) expect(kept).toEqual(["public landing shell"]);
  });

  it("does not serve an older worker's map document offline before or after activation", async () => {
    const landing = new Response("landing shell");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-shell-legacy-active": [
          ["/", landing],
          ["/map", new Response("older map document")],
        ],
      },
    });
    for (const phase of ["before activation", "after activation"]) {
      if (phase === "after activation") {
        await Promise.all(dispatchLifecycle(listeners.get("activate")!));
        expect(records.get("pubmax-sw-shell-target")?.has(`${origin}/map`) ?? false).toBe(false);
      }
      const navigation = dispatchFetch(listeners.get("fetch")!, {
        method: "GET",
        mode: "navigate",
        url: `${origin}/map?drink=wine`,
      } as Request);
      expect(await navigation.response, phase).toBe(landing);
    }
  });
});

describe("trusted Plan preview continuity", () => {
  it.each([
    { importFails: false, rejectCurrentWrites: false },
    { importFails: false, rejectCurrentWrites: true },
    { importFails: true, rejectCurrentWrites: false },
    { importFails: true, rejectCurrentWrites: true },
  ])("prefers trusted preview over unsafe old families with importFails=$importFails and rejectCurrentWrites=$rejectCurrentWrites", async ({ importFails, rejectCurrentWrites }) => {
    const unsafe = new Response("venue-private-old-plan-cache");
    const trusted = new Response("Public Plan preview: two stops at 19:00");
    const { listeners, records } = rolloutWorkerHarness({
      importError: importFails ? new Error("helper unavailable") : undefined,
      rejectCurrentWrites,
      rejectDeletes: true,
      entries: {
        "pubmax-sw-plan-target": [["/plan/shared?old=1", unsafe]],
        "pubmax-sw-plan-legacy-active": [["/plan/shared?old=1", unsafe]],
        "pubmax-sw-preview-plan-v2-previous": [["/plan/shared?trusted=1", trusted]],
        "pubmax-sw-shell-target": [["/", new Response("Public landing shell")]],
      },
    });

    for (const activate of [false, true]) {
      if (activate) await Promise.all(dispatchLifecycle(listeners.get("activate")!));
      const navigation = dispatchFetch(listeners.get("fetch")!, {
        method: "GET",
        mode: "navigate",
        url: "https://pubmaxxing.com/plan/shared?account=B",
      } as Request);
      const response = (await navigation.response) as Response;
      expect(response).toBe(trusted);
      expect(await response.clone().text()).not.toContain("venue-private-old-plan-cache");
      expect(records.get("pubmax-sw-plan-target")?.has("https://pubmaxxing.com/plan/shared?old=1"))
        .toBe(true);
    }
  });
});

describe("old Plan navigation privacy", () => {
  const cases = [false, true].flatMap((importFails) =>
    [false, true].flatMap((rejectCurrentWrites) =>
      ["pubmax-sw-plan-target", "pubmax-sw-plan-legacy-active"].flatMap((oldCache) =>
        [false, true].map((activate) => ({ importFails, rejectCurrentWrites, oldCache, activate })),
      ),
    ),
  );

  it.each(cases)(
    "withholds $oldCache HTML offline with activate=$activate, importFails=$importFails, rejectCurrentWrites=$rejectCurrentWrites and failed deletion",
    async ({ oldCache, activate, importFails, rejectCurrentWrites }) => {
      const privateAnchor = "venue-private-old-plan-cache";
      const home = new Response("Public landing shell");
      // Synthetic inline Flight marker models the bytes leaked by the old page.
      // This checks real worker behavior, not Next serialization or account auth.
      const oldHtml = new Response(
        `<html><script>self.__next_f.push([1,'{"anchorVenueId":"${privateAnchor}"}'])</script></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
      const { listeners, records } = rolloutWorkerHarness({
        importError: importFails ? new Error("helper unavailable") : undefined,
        rejectCurrentWrites,
        rejectDeletes: true,
        entries: {
          [oldCache]: [["/plan/private-night?old=1", oldHtml]],
          "pubmax-sw-shell-target": [["/", home]],
        },
      });
      // Cache deletion is best-effort. Privacy must hold when old bytes remain.
      if (activate) await Promise.all(dispatchLifecycle(listeners.get("activate")!));
      expect(records.get(oldCache)?.has("https://pubmaxxing.com/plan/private-night?old=1"))
        .toBe(true);
      const navigation = dispatchFetch(listeners.get("fetch")!, {
        method: "GET",
        mode: "navigate",
        url: "https://pubmaxxing.com/plan/private-night?account=B",
      } as Request);
      const response = (await navigation.response) as Response;
      expect(await response.clone().text()).not.toContain(privateAnchor);
      expect(response).toBe(home);
    },
  );
});
