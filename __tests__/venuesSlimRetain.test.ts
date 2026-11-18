import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const offlineGet = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: { get: offlineGet, set: async () => true },
}));

import {
  loadSlimVenuesFromPathResult,
  retainSlimVenuesFromPath,
} from "@/lib/venuesSlim";

const ROW = {
  id: "venue-retain-1",
  name: "Retain Arms",
  lat: 51.5,
  lng: -0.1,
  cheapestPrice: null,
  borough: "Camden",
};

type PendingCall = {
  path: string;
  signal: AbortSignal | undefined;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

function pendingFetch() {
  const calls: PendingCall[] = [];
  const waiters: Array<{ count: number; done: () => void }> = [];
  const issued = (count: number) => new Promise<void>((done) => {
    if (calls.length >= count) done();
    else waiters.push({ count, done });
  });
  const impl = vi.fn((path: string, init?: RequestInit) => {
    const call = {} as PendingCall;
    const promise = new Promise<Response>((resolve, reject) => {
      call.path = path;
      call.signal = init?.signal ?? undefined;
      call.resolve = resolve;
      call.reject = reject;
    });
    init?.signal?.addEventListener("abort", () => {
      call.reject(new DOMException("The operation was aborted.", "AbortError"));
    });
    calls.push(call);
    for (const waiter of waiters) if (calls.length >= waiter.count) waiter.done();
    return promise;
  });
  return { impl, calls, issued };
}

const settleMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

let fetchCalls: PendingCall[];
let fetchIssued: (count: number) => Promise<void>;
beforeEach(() => {
  offlineGet.mockReset().mockImplementation(async () => null);
  const { impl, calls, issued } = pendingFetch();
  fetchCalls = calls;
  fetchIssued = issued;
  vi.stubGlobal("fetch", impl);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retained slim venue loads", () => {
  it("shares one fetch across holds and aborts when the last hold releases", async () => {
    const a = retainSlimVenuesFromPath("/data/retained.json");
    const b = retainSlimVenuesFromPath("/data/retained.json");
    const seen = b.promise.catch(() => "aborted");
    expect(fetch).toHaveBeenCalledTimes(1);

    a.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(false);

    b.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(true);
    await expect(seen).resolves.toBe("aborted");
    await expect(a.promise).rejects.toThrow("aborted");
  });

  it("never aborts a load that has already settled", async () => {
    const hold = retainSlimVenuesFromPath("/data/settled.json");
    fetchCalls[0]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(hold.promise).resolves.toEqual({ rows: [ROW], status: "ready" });

    hold.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(false);
  });

  it("keeps a shared (unscoped) load alive after every hold releases", async () => {
    const hold = retainSlimVenuesFromPath("/data/shared.json");
    const shared = loadSlimVenuesFromPathResult("/data/shared.json");
    expect(fetch).toHaveBeenCalledTimes(1);

    hold.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(false);

    fetchCalls[0]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(shared).resolves.toEqual({ rows: [ROW], status: "ready" });
  });

  it("survives a release that is re-joined inside the same task", async () => {
    const first = retainSlimVenuesFromPath("/data/remount.json");
    first.release();
    const second = retainSlimVenuesFromPath("/data/remount.json");
    await settleMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchCalls[0]!.signal?.aborted).toBe(false);
    fetchCalls[0]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(second.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  });

  it("fetches again once an aborted load has gone", async () => {
    const first = retainSlimVenuesFromPath("/data/retry.json");
    const gone = first.promise.catch(() => "aborted");
    first.release();
    await settleMicrotasks();
    await expect(gone).resolves.toBe("aborted");

    const second = retainSlimVenuesFromPath("/data/retry.json");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetchCalls[1]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(second.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  });

  it("treats a double release as one", async () => {
    const a = retainSlimVenuesFromPath("/data/idempotent.json");
    const b = retainSlimVenuesFromPath("/data/idempotent.json");
    const gone = b.promise.catch(() => "aborted");
    a.release();
    a.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(false);

    b.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(true);
    await expect(gone).resolves.toBe("aborted");
  });

  it("gives a bypass hold its own request and its own lifecycle", async () => {
    const shared = retainSlimVenuesFromPath("/data/bypass.json");
    const bypass = retainSlimVenuesFromPath("/data/bypass.json", { bypassInFlight: true });
    const gone = bypass.promise.catch(() => "aborted");
    expect(fetch).toHaveBeenCalledTimes(2);

    bypass.release();
    await settleMicrotasks();
    expect(fetchCalls[1]!.signal?.aborted).toBe(true);
    expect(fetchCalls[0]!.signal?.aborted).toBe(false);
    await expect(gone).resolves.toBe("aborted");

    shared.release();
    await settleMicrotasks();
    expect(fetchCalls[0]!.signal?.aborted).toBe(true);
    await expect(shared.promise).rejects.toThrow("aborted");
  });

  it("lets the next caller retry a rejected load", async () => {
    const first = retainSlimVenuesFromPath("/data/rejected.json");
    const failed = first.promise.catch(() => "failed");
    fetchCalls[0]!.reject(new Error("HTTP 500"));
    await expect(failed).resolves.toBe("failed");

    const second = retainSlimVenuesFromPath("/data/rejected.json");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetchCalls[1]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(second.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  });

  it("keeps a load whose bytes have landed for the next reader", async () => {
    let answerOffline!: (value: null) => void;
    const offlineAsked = new Promise<void>((asked) => {
      offlineGet.mockImplementationOnce(() => {
        asked();
        return new Promise((resolve) => {
          answerOffline = resolve;
        });
      });
    });
    const pal = retainSlimVenuesFromPath("/data/landed.json");
    fetchCalls[0]!.resolve(new Response(JSON.stringify([ROW])));
    await offlineAsked;

    pal.release();
    await settleMicrotasks();
    const map = loadSlimVenuesFromPathResult("/data/landed.json");
    expect(fetch).toHaveBeenCalledTimes(1);
    answerOffline(null);

    await expect(map).resolves.toEqual({ rows: [ROW], status: "ready" });
    await expect(pal.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  });

  it("never drops a head-start payload the map is still to read", async () => {
    let landWarm!: (payload: unknown) => void;
    const warm = new Promise((resolve) => {
      landWarm = resolve;
    });
    vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map([["/data/warm.json", warm]]) } });
    const pal = retainSlimVenuesFromPath("/data/warm.json");

    pal.release();
    await settleMicrotasks();
    const map = loadSlimVenuesFromPathResult("/data/warm.json");
    landWarm([ROW]);

    await expect(map).resolves.toEqual({ rows: [ROW], status: "ready" });
    await expect(pal.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches nothing when a released head-start payload fails and nobody is left to read", async () => {
    let failWarm!: (error: unknown) => void;
    const warm = new Promise((_, reject) => {
      failWarm = reject;
    });
    vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map([["/data/warm-fail.json", warm]]) } });
    const pal = retainSlimVenuesFromPath("/data/warm-fail.json");
    const gone = pal.promise.catch(() => "aborted");

    pal.release();
    await settleMicrotasks();
    failWarm(new Error("warm failed"));

    await expect(gone).resolves.toBe("aborted");
    expect(fetch).not.toHaveBeenCalled();
    expect(offlineGet).not.toHaveBeenCalled();
  });

  it("still fetches when a head-start payload fails while a reader remains", async () => {
    let failWarm!: (error: unknown) => void;
    const warm = new Promise((_, reject) => {
      failWarm = reject;
    });
    vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map([["/data/warm-kept.json", warm]]) } });
    const pal = retainSlimVenuesFromPath("/data/warm-kept.json");
    failWarm(new Error("warm failed"));

    await fetchIssued(1);
    fetchCalls[0]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(pal.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  });

  it("skips the revision retry when the stale head-start payload lands after the last release", async () => {
    let landWarm!: (payload: unknown) => void;
    const warm = new Promise((resolve) => {
      landWarm = resolve;
    });
    vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map([["/data/stale.json", warm]]) } });
    const pal = retainSlimVenuesFromPath("/data/stale.json", { expectedRevision: "target" });
    const gone = pal.promise.catch(() => "aborted");

    pal.release();
    await settleMicrotasks();
    landWarm({ revision: "previous", rows: [ROW] });

    await expect(gone).resolves.toBe("aborted");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts an in-flight revision retry when the last reader releases", async () => {
    const pal = retainSlimVenuesFromPath("/data/retry-revision.json", { expectedRevision: "target" });
    const gone = pal.promise.catch(() => "aborted");
    fetchCalls[0]!.resolve(new Response(JSON.stringify({ revision: "previous", rows: [ROW] })));
    await fetchIssued(2);

    pal.release();
    await settleMicrotasks();

    expect(fetchCalls[1]!.signal?.aborted).toBe(true);
    await expect(gone).resolves.toBe("aborted");
    expect(offlineGet).not.toHaveBeenCalled();
  });

  describe("a reader rejoining in the release grace while the head-start payload reopens the network", () => {
    type Settle = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
    const fails = (settle: Settle) => settle.reject(new Error("warm failed"));
    const landsStale = (settle: Settle) => settle.resolve({ revision: "previous", rows: [ROW] });
    const sameTask = (rejoin: () => void, release: () => void) => { release(); rejoin(); };
    // The payload's continuation is queued before the rejoin. A failed payload
    // reopens in that continuation, so it runs with no hold before the rejoin.
    const reopenFirst = (rejoin: () => void, release: () => void) => { queueMicrotask(rejoin); release(); };

    it.each([
      ["fails, rejoined in the same task", fails, sameTask, false],
      ["lands stale, rejoined in the same task", landsStale, sameTask, false],
      ["fails, rejoined after the reopen", fails, reopenFirst, true],
      ["lands stale, rejoined in a queued microtask", landsStale, reopenFirst, false],
    ] as const)("gives the new reader one live request when the payload %s", async (_case, settleWarm, order, oldEntryAbandoned) => {
      const path = "/data/grace-rejoin.json";
      const settle = {} as Settle;
      const warm = new Promise((resolve, reject) => Object.assign(settle, { resolve, reject }));
      vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map([[path, warm]]) } });
      const pal = retainSlimVenuesFromPath(path, { expectedRevision: "target" });
      const palSettled = pal.promise.then(() => "served", () => "aborted");
      let map!: ReturnType<typeof retainSlimVenuesFromPath>;

      settleWarm(settle);
      order(() => { map = retainSlimVenuesFromPath(path, { expectedRevision: "target" }); }, pal.release);
      await fetchIssued(1);
      if (oldEntryAbandoned) await expect(palSettled).resolves.toBe("aborted");
      const later = loadSlimVenuesFromPathResult(path, { expectedRevision: "target" });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetchCalls[0]!.signal?.aborted).toBe(false);
      fetchCalls[0]!.resolve(new Response(JSON.stringify({ revision: "target", rows: [ROW] })));
      await expect(map.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
      await expect(later).resolves.toEqual({ rows: [ROW], status: "ready" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("completes a revision retry that a reader still holds", async () => {
    const pal = retainSlimVenuesFromPath("/data/retry-held.json", { expectedRevision: "target" });
    fetchCalls[0]!.resolve(new Response(JSON.stringify({ revision: "previous", rows: [ROW] })));
    await fetchIssued(2);
    fetchCalls[1]!.resolve(new Response(JSON.stringify({ revision: "target", rows: [ROW] })));
    await expect(pal.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  });
});

it("starts a waiting data read only after the drawn line releases it", async () => {
  const { holdFairPintDraw } = await import("@/lib/mapFirstVisitArrivalGate");
  const endDraw = holdFairPintDraw();
  const hold = retainSlimVenuesFromPath("/data/after-draw.json");
  try {
    expect(fetchCalls).toHaveLength(0);
    endDraw();
    await fetchIssued(1);
    fetchCalls[0]!.resolve(new Response(JSON.stringify([ROW])));
    await expect(hold.promise).resolves.toEqual({ rows: [ROW], status: "ready" });
  } finally { endDraw(); hold.release(); }
});

it("does not start a cancelled data read when a pending draw completes", async () => {
  const { holdFairPintDraw } = await import("@/lib/mapFirstVisitArrivalGate");
  const endDraw = holdFairPintDraw();
  const hold = retainSlimVenuesFromPath("/data/cancelled-during-draw.json");
  const result = hold.promise.catch((error: unknown) => error);
  try {
    hold.release();
    await settleMicrotasks();
    endDraw();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(fetchCalls).toHaveLength(0);
  } finally { endDraw(); }
});
