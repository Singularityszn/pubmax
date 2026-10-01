import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSurfaceCache,
  loadSurfaceJson,
  readSurfaceSnapshot,
  surfaceCacheSize,
  SURFACE_CACHE_NAMESPACE,
  writeSurfaceSnapshot,
} from "@/lib/surfaceDataCache";
import {
  DEVICE_ACCOUNT_OWNER_KEY,
  DEVICE_IDENTITY_CHANGED_EVENT,
} from "@/lib/deviceAccountIdentity";

// TWO SURFACES ASKING ONE QUESTION ARE ONE REQUEST.
//
// A venue sheet mounts several readers at once, and two of them read the same
// URL: `/api/whats-on?window=tonight&limit=60` (the map lane and the venue
// chips) and `/api/citymcp/places?q=...` (the place strip and the buzz card).
// Both are `no-store`, so each duplicate was a second function invocation and a
// second round trip for an answer already on its way.

beforeEach(() => {
  clearSurfaceCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deferredFetch(body: unknown) {
  let release: () => void = () => {};
  let markEntered: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = vi.fn(async () => {
    markEntered();
    await gate;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchImpl, entered, release: () => release() };
}

describe("loadSurfaceJson shares a read that is already in flight", () => {
  it("asks once for two callers that arrive together", async () => {
    const { fetchImpl, release } = deferredFetch({ rows: [1] });
    const seen: string[] = [];
    const first = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {
        seen.push("first");
      },
    );
    const second = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {
        seen.push("second");
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    release();
    expect(await first).toBe("network");
    expect(await second).toBe("network");
    // One request, and BOTH callers were given the answer.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen.sort()).toEqual(["first", "second"]);
  });

  it("still asks again once the first read has settled and its answer aged out", async () => {
    const { fetchImpl, release } = deferredFetch({ rows: [1] });
    const first = loadSurfaceJson<{ rows: number[] }>(
      "/api/citymcp/places?q=The%20Lamb&limit=5",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {},
    );
    release();
    await first;
    clearSurfaceCache();
    const { fetchImpl: second, release: releaseSecond } = deferredFetch({ rows: [2] });
    const run = loadSurfaceJson<{ rows: number[] }>(
      "/api/citymcp/places?q=The%20Lamb&limit=5",
      { fetchImpl: second as unknown as typeof fetch },
      () => {},
    );
    releaseSecond();
    await run;
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("one caller aborting does not take the answer away from the other", async () => {
    const { fetchImpl, release } = deferredFetch({ rows: [1] });
    const controller = new AbortController();
    const applied: string[] = [];
    const leaving = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal },
      () => {
        applied.push("leaving");
      },
    );
    const staying = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {
        applied.push("staying");
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    release();
    await leaving;
    expect(await staying).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(applied).toEqual(["staying"]);
  });
});

describe("an identity boundary retires earlier shared reads", () => {
  let sessionStorage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    sessionStorage = {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key) { return values.get(key) ?? null; },
      key(index) { return Array.from(values.keys())[index] ?? null; },
      removeItem(key) { values.delete(key); },
      setItem(key, value) { values.set(key, value); },
    };
    const browser = Object.assign(new EventTarget(), { sessionStorage });
    vi.stubGlobal("window", browser);
  });

  afterEach(() => {
    clearSurfaceCache();
    vi.unstubAllGlobals();
  });

  const boundaries = [
    {
      name: "same-tab identity event",
      clear: () => window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT)),
    },
    { name: "explicit cache clear", clear: () => clearSurfaceCache() },
    {
      name: "cross-tab account-owner storage event",
      clear: () => {
        const event = new Event("storage");
        Object.defineProperty(event, "key", { value: DEVICE_ACCOUNT_OWNER_KEY });
        window.dispatchEvent(event);
      },
    },
  ];

  it.each(boundaries)("$name prevents an earlier response from recreating snapshots", async ({ clear }) => {
    const key = "/api/profiles/cache-owner/covers";
    const body = { covers: ["before-boundary"] };
    const pending = deferredFetch(body);
    const read = loadSurfaceJson(
      key,
      { fetchImpl: pending.fetchImpl as unknown as typeof fetch },
      () => {},
    );
    try {
      await pending.entered;
      writeSurfaceSnapshot("/api/whats-on?held-control", { rows: ["held"] });
      expect(surfaceCacheSize()).toBe(1);
      expect(sessionStorage.length).toBe(1);

      clear();
      expect(surfaceCacheSize()).toBe(0);
      expect(sessionStorage.length).toBe(0);

      pending.release();
      await read;
      expect(surfaceCacheSize()).toBe(0);
      expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toBeNull();
      expect(readSurfaceSnapshot(key)).toBeUndefined();
    } finally {
      pending.release();
      await read;
    }
  });

  it.each(boundaries)("$name starts a new same-key read and keeps it joinable when the old read settles", async ({ clear }) => {
    const key = "/api/profiles/cache-owner/covers";
    const oldFetch = deferredFetch({ covers: ["before-boundary"] });
    const currentBody = { covers: ["after-boundary"] };
    const currentFetch = deferredFetch(currentBody);
    const applied: unknown[] = [];
    const unexpectedFetch = vi.fn(async () => new Response(JSON.stringify({ covers: ["wrong-request"] })));
    const oldRead = loadSurfaceJson(
      key,
      { fetchImpl: oldFetch.fetchImpl as unknown as typeof fetch },
      () => {},
    );
    const reads: Promise<unknown>[] = [oldRead];
    try {
      await oldFetch.entered;
      clear();
      const currentRead = loadSurfaceJson(
        key,
        { fetchImpl: currentFetch.fetchImpl as unknown as typeof fetch },
        (body) => { applied.push(body); },
      );
      reads.push(currentRead);
      await vi.waitFor(() => expect(currentFetch.fetchImpl).toHaveBeenCalledTimes(1));

      oldFetch.release();
      await oldRead;
      expect(surfaceCacheSize()).toBe(0);
      expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toBeNull();

      // The old finalizer must not evict the new request. This caller reaches
      // its initial microtask before releasing the new fetch can settle it.
      const joiningRead = loadSurfaceJson(
        key,
        { fetchImpl: unexpectedFetch as unknown as typeof fetch },
        (body) => { applied.push(body); },
      );
      reads.push(joiningRead);
      currentFetch.release();
      expect(await currentRead).toBe("network");
      expect(await joiningRead).toBe("network");
      expect(unexpectedFetch).not.toHaveBeenCalled();
      expect(currentFetch.fetchImpl).toHaveBeenCalledTimes(1);
      expect(applied).toEqual([currentBody, currentBody]);
      expect(readSurfaceSnapshot(key)).toEqual(currentBody);
      expect(JSON.parse(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`) ?? "null")?.value)
        .toEqual(currentBody);
    } finally {
      oldFetch.release();
      currentFetch.release();
      await Promise.allSettled(reads);
    }
  });

  it("still answers a mounted public reader without holding its pre-boundary response", async () => {
    const key = "/api/whats-on?window=tonight&limit=60";
    const body = { rows: ["public-listing"] };
    const pending = deferredFetch(body);
    const apply = vi.fn();
    const read = loadSurfaceJson(
      key,
      { fetchImpl: pending.fetchImpl as unknown as typeof fetch },
      apply,
    );
    try {
      await pending.entered;
      window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
      pending.release();

      expect(await read).toBe("network");
      expect(apply).toHaveBeenCalledExactlyOnceWith(body, "network");
      expect(pending.fetchImpl).toHaveBeenCalledTimes(1);
      expect(surfaceCacheSize()).toBe(0);
      expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toBeNull();
      expect(readSurfaceSnapshot(key)).toBeUndefined();
    } finally {
      pending.release();
      await read;
    }
  });
});

describe("the CityMCP place search has one owner", () => {
  it("is asked for through lib/cityPlaceSearch.ts and nowhere else", () => {
    const root = process.cwd();
    const owner = path.join(root, "lib", "cityPlaceSearch.ts");
    expect(readFileSync(owner, "utf8")).toContain("/api/citymcp/places?");
    for (const file of [
      path.join(root, "components", "map", "VenueBuzz.tsx"),
      path.join(root, "components", "map", "CityPlaceStrip.tsx"),
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("searchCityPlacesByName");
      expect(source).not.toContain("/api/citymcp/places?");
    }
  });
});
