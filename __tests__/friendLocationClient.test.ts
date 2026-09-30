import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FriendLocationClient, type FriendLocationRequest } from "@/lib/friendLocationClient";
import type { FriendLocationRead } from "@/lib/friendLocation";

const own = { sessionId: "10000000-0000-4000-8000-000000000001", revision: 1, recipients: ["mate"], expiresAt: new Date(Date.now() + 3_600_000).toISOString(), accuracy: 110 };
const read: FriendLocationRead = { ok: true, generation: 0, own: null, mutuals: [{ profileId: "mate", handle: "bob" }], friends: [] };
const position = { coords: { latitude: 51.512345, longitude: -0.123456, accuracy: 9 } } as GeolocationPosition;
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let client: FriendLocationClient;
let geo: Geolocation;
let request: ReturnType<typeof vi.fn<FriendLocationRequest>>;
let locate: PositionCallback;
let denied: PositionErrorCallback;
let watch: PositionCallback;
let permission: ReturnType<typeof vi.fn<() => Promise<PermissionState>>>;
beforeEach(() => {
  vi.useFakeTimers();
  request = vi.fn<FriendLocationRequest>(async () => read);
  geo = { getCurrentPosition: vi.fn((success, error) => { locate = success; denied = error; }), watchPosition: vi.fn((success) => { watch = success; return 4; }), clearWatch: vi.fn() } as unknown as Geolocation;
  permission = vi.fn<() => Promise<PermissionState>>(async () => "granted");
  client = new FriendLocationClient(request, geo, permission);
});
afterEach(() => { client.dispose(); vi.useRealTimers(); });
describe("foreground friend sharing", () => {
  it("starts with a fresh native fix when low accuracy mode cannot supply one", async () => {
    vi.mocked(geo.getCurrentPosition).mockImplementation((success, error, options) => {
      if (options?.enableHighAccuracy && options.maximumAge === 0) success(position);
      else error?.({ code: 2 } as GeolocationPositionError);
    });
    let shared = false;
    request.mockImplementation(async (method) => {
      if (method === "POST") shared = true;
      return shared ? { ...read, generation: 1, own } : read;
    });
    client.setVisible(true); await settle();
    await client.start(["mate"]);
    expect(request.mock.calls.some(([method]) => method === "POST")).toBe(true);
    expect(client.getSnapshot().message).toBe("Sharing with selected mates.");
  });
  it("requests permission only on explicit start; denial never sends coordinates", async () => {
    client.setVisible(true); await settle();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    const start = client.start(["mate"]);
    denied({ code: 1 } as GeolocationPositionError); await start;
    expect(request.mock.calls.map((args) => args[0])).toEqual(["GET"]);
    expect(client.getSnapshot().message).toContain("No location was shared");
  });
  it("coarsens before egress, clears hidden points, stops watches and ignores delayed location", async () => {
    client.setVisible(true); await settle();
    request.mockImplementation(async (method) => ({ ...read, own: method === "POST" || method === "PATCH" ? own : null }));
    const start = client.start(["mate"]); locate(position); await start;
    expect(request).toHaveBeenCalledWith("POST", { recipients: ["mate"], latitude: 51.512, longitude: -0.123, accuracy: 110, expectedGeneration: 0 }, expect.any(AbortSignal));
    client.setVisible(false);
    expect(geo.clearWatch).toHaveBeenCalledWith(4);
    const calls = request.mock.calls.length; watch(position); await settle();
    expect(request.mock.calls.length).toBe(calls);
    expect(client.getSnapshot().friends).toEqual([]);
  });
  it("reconciles an accepted share after its POST response is lost without claiming sharing never started", async () => {
    client.setVisible(true); await settle();
    let finishRead!: (value: FriendLocationRead) => void;
    request.mockImplementation((method, body) => method === "POST" && !(body as { action?: string })?.action
      ? Promise.reject(new Error("connection lost after server start"))
      : new Promise((resolve) => { finishRead = resolve; }));
    const start = client.start(["mate"]); locate(position); await start;
    expect(client.getSnapshot().message).toContain("unconfirmed");
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(request.mock.calls.map((args) => args[0])).toEqual(["GET", "POST", "POST"]);
    finishRead({ ...read, own }); await settle();
    expect(client.getSnapshot().own).toEqual(own);
    expect(client.getSnapshot().status).toBe("paused");
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
  });
  it("keeps lost-start authority pending through read failures and visibility changes without replacing the share", async () => {
    client.setVisible(true); await settle();
    request.mockRejectedValue(new Error("connection lost after server start"));
    const start = client.start(["mate"]); locate(position); await start; await settle();
    expect(client.getSnapshot().status).toBe("start-unconfirmed");
    expect(client.getSnapshot().message).toContain("unconfirmed");
    await client.start(["mate"]);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter((args) => args[0] === "POST" && !(args[1] as { action?: string })?.action)).toHaveLength(1);
    client.setVisible(false);
    expect(client.getSnapshot().message).toContain("unconfirmed");
    request.mockResolvedValue({ ...read, own });
    client.setVisible(true); await settle();
    expect(client.getSnapshot().own).toEqual(own);
    expect(client.getSnapshot().status).toBe("paused");
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
    expect(request.mock.calls.filter((args) => args[0] === "POST" && !(args[1] as { action?: string })?.action)).toHaveLength(1);
  });
  it("keeps a submitted start unconfirmed if the page hides before its response and the next read fails", async () => {
    client.setVisible(true); await settle();
    let finishStart!: (value: FriendLocationRead) => void;
    request.mockImplementation((method, body) => method === "POST" && !(body as { action?: string })?.action
      ? new Promise((resolve) => { finishStart = resolve; })
      : Promise.reject(new Error("authority read unavailable")));
    const start = client.start(["mate"]); locate(position); await settle();
    expect(client.getSnapshot().status).toBe("starting");
    const postSignal = request.mock.calls.find((args) => args[0] === "POST")?.[2];
    client.setVisible(false);
    expect(postSignal?.aborted).toBe(true);
    expect(client.getSnapshot().status).toBe("start-unconfirmed");
    client.setVisible(true); await settle();
    expect(client.getSnapshot().status).toBe("start-unconfirmed");
    expect(client.getSnapshot().message).toContain("unconfirmed");
    finishStart({ ...read, own }); await start;
    expect(client.getSnapshot().status).toBe("start-unconfirmed");
    expect(client.getSnapshot().own).toBeNull();
    await client.start(["mate"]);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(request.mock.calls.filter((args) => args[0] === "POST" && !(args[1] as { action?: string })?.action)).toHaveLength(1);
    request.mockResolvedValue({ ...read, own });
    await client.refresh();
    expect(client.getSnapshot().own).toEqual(own);
    expect(client.getSnapshot().status).toBe("paused");
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled();
  });
  it("fences a pending start generation before treating an empty authority read as permission to start again", async () => {
    const initialRead = { ...read, generation: 0 };
    request.mockResolvedValue(initialRead);
    client.setVisible(true); await settle();
    let finishOriginal!: (value: FriendLocationRead) => void;
    const newerOwn = { ...own, sessionId: "20000000-0000-4000-8000-000000000001" };
    let originalSubmitted = false;
    let newerStarted = false;
    request.mockImplementation((method, body) => {
      const input = body as Record<string, unknown> | undefined;
      if (method === "POST" && input?.action === "reconcile") return Promise.resolve({ ...read, generation: 1 });
      if (method === "POST" && !originalSubmitted) {
        originalSubmitted = true;
        return new Promise((resolve) => { finishOriginal = resolve; });
      }
      if (method === "POST") {
        newerStarted = true;
        return Promise.resolve({ ...read, generation: 2, own: newerOwn });
      }
      if (newerStarted) return Promise.resolve({ ...read, generation: 2, own: newerOwn });
      return Promise.resolve({ ...read, generation: originalSubmitted ? 1 : 0 });
    });
    const original = client.start(["mate"]); locate(position); await settle();
    client.setVisible(false);
    client.setVisible(true); await settle();
    expect(request.mock.calls).toContainEqual(["POST", { action: "reconcile", expectedGeneration: 0 }, expect.any(AbortSignal)]);
    expect(client.getSnapshot().status).toBe("ready");
    expect(client.getSnapshot().own).toBeNull();
    finishOriginal({ ...read, own }); await original;
    expect(client.getSnapshot().own).toBeNull();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    const newer = client.start(["mate"]); locate(position); await newer;
    const starts = request.mock.calls.filter(([method, body]) => method === "POST" && !(body as Record<string, unknown>)?.action);
    expect(starts[0]?.[1]).toHaveProperty("expectedGeneration", 0);
    expect(starts[1]?.[1]).toHaveProperty("expectedGeneration", 1);
  });
  it("keeps a confirmed Stop above an older read and uses its generation for the next explicit start", async () => {
    const initialRead = { ...read, generation: 0 };
    request.mockResolvedValue(initialRead);
    client.setVisible(true); await settle();
    let starts = 0;
    const newerOwn = { ...own, sessionId: "20000000-0000-4000-8000-000000000001" };
    request.mockImplementation(async (method) => {
      if (method === "POST") { starts++; return { ...read, own: starts === 1 ? own : newerOwn, generation: starts === 1 ? 1 : 3 }; }
      if (method === "DELETE") return { ...read, own: null, generation: 2 };
      return { ...read, own, generation: 1 };
    });
    const original = client.start(["mate"]); locate(position); await original; await settle();
    await client.stop(); await settle();
    expect(client.getSnapshot().own).toBeNull();
    const newer = client.start(["mate"]); locate(position); await newer; await settle();
    const sent = request.mock.calls.filter(([method]) => method === "POST");
    expect(sent[1]?.[1]).toHaveProperty("expectedGeneration", 2);
    expect(client.getSnapshot().own?.sessionId).toBe(newerOwn.sessionId);
  });
  it("keeps revoke failure visible and prevents delayed updates restoring sharing", async () => {
    client.setVisible(true); await settle();
    let rejectRevoke!: (error: Error) => void;
    request.mockImplementation((method) => method === "DELETE" ? new Promise((_resolve, reject) => { rejectRevoke = reject; }) : Promise.resolve({ ...read, own }));
    const start = client.start(["mate"]); locate(position); await start; await settle();
    const stop = client.stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(4);
    expect(client.getSnapshot().status).toBe("revoking");
    rejectRevoke(new Error("offline")); await stop;
    expect(client.getSnapshot().status).toBe("revoke-error");
    expect(client.getSnapshot().own).toEqual(own);
    expect(client.getSnapshot().message).toContain("unconfirmed");
    watch(position); await settle();
    expect(request.mock.calls.some((args) => args[0] === "PATCH")).toBe(false);
  });
  it("drops coordinates on failed poll and on disposal", async () => {
    const friend = { profileId: "mate", handle: "bob", latitude: 51.5, longitude: -0.1, accuracy: 110, updatedAt: new Date().toISOString(), expiresAt: own.expiresAt };
    request.mockResolvedValue({ ...read, friends: [friend] });
    client.setVisible(true); await settle();
    expect(client.getSnapshot().friends).toHaveLength(1);
    request.mockRejectedValue(new Error("denied")); await client.refresh();
    expect(client.getSnapshot().friends).toEqual([]);
    client.dispose();
    expect(client.getSnapshot().friends).toEqual([]);
  });
});

describe("revocation across visibility and delayed writes", () => {
  it("finishes a pending revoke after the page hides", async () => {
    client.setVisible(true); await settle();
    let finishRevoke!: (value: FriendLocationRead) => void;
    request.mockImplementation((method) => method === "DELETE" ? new Promise((resolve) => { finishRevoke = resolve; }) : Promise.resolve({ ...read, own }));
    const start = client.start(["mate"]); locate(position); await start; await settle();
    const stopping = client.stop();
    client.setVisible(false);
    finishRevoke({ ...read, own: null }); await stopping;
    expect(client.getSnapshot().own).toBeNull();
    expect(client.getSnapshot().status).toBe("ready");
  });

  it("does not let a late read overwrite a successful update revision", async () => {
    client.setVisible(true); await settle();
    let finishRead!: (value: FriendLocationRead) => void;
    request.mockImplementation((method) => method === "GET" ? new Promise((resolve) => { finishRead = resolve; }) : Promise.resolve({ ...read, own: { ...own, revision: method === "PATCH" ? 2 : 1 } }));
    const start = client.start(["mate"]); locate(position); await start;
    watch(position); await settle();
    expect(client.getSnapshot().own?.revision).toBe(2);
    finishRead({ ...read, own }); await settle();
    expect(client.getSnapshot().own?.revision).toBe(2);
  });

  it("does not let a delayed update response regress a newer read revision", async () => {
    client.setVisible(true); await settle();
    let finishUpdate!: (value: FriendLocationRead) => void;
    let readRevision = 1;
    request.mockImplementation((method) => method === "PATCH"
      ? new Promise((resolve) => { finishUpdate = resolve; })
      : Promise.resolve({ ...read, own: { ...own, revision: readRevision } }));
    const start = client.start(["mate"]); locate(position); await start; await settle();
    watch(position); await settle();
    readRevision = 3;
    await client.refresh();
    expect(client.getSnapshot().own?.revision).toBe(3);
    finishUpdate({ ...read, own: { ...own, revision: 2 } }); await settle();
    expect(client.getSnapshot().own?.revision).toBe(3);
  });
  it("does not let a delayed point-update receipt lower the confirmed account generation", async () => {
    const initialRead = { ...read, generation: 0 };
    request.mockResolvedValue(initialRead);
    client.setVisible(true); await settle();
    let finishUpdate!: (value: FriendLocationRead) => void;
    let generation = 1;
    request.mockImplementation((method) => method === "PATCH"
      ? new Promise((resolve) => { finishUpdate = resolve; })
      : Promise.resolve({ ...read, own, generation }));
    const start = client.start(["mate"]); locate(position); await start; await settle();
    watch(position); await settle();
    generation = 2;
    await client.refresh();
    const olderReceipt = { ...read, own: { ...own, revision: 2 }, generation: 1 };
    finishUpdate(olderReceipt); await settle();
    expect(client.getSnapshot()).toHaveProperty("generation", 2);
  });

  it("reports another active session after revoke conflict instead of claiming sharing stopped", async () => {
    client.setVisible(true); await settle();
    let replaced = false;
    const replacement = { ...own, sessionId: "20000000-0000-4000-8000-000000000001" };
    request.mockImplementation((method) => {
      if (method === "DELETE") { replaced = true; return Promise.reject(new Error("conflict")); }
      return Promise.resolve({ ...read, own: replaced ? replacement : own });
    });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    await client.stop();
    expect(client.getSnapshot().own).toEqual(replacement);
    expect(client.getSnapshot().message).not.toBe("Sharing stopped.");
    expect(client.getSnapshot().status).toBe("error");
  });

  it("fences a missing session before confirming Stop after a revoke conflict", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    request.mockImplementation((method, body) => {
      if (method === "DELETE") return Promise.reject(new Error("conflict"));
      if (method === "POST" && (body as { action?: string })?.action === "reconcile") return Promise.resolve({ ...read, generation: 1 });
      return Promise.resolve(read);
    });
    await client.stop();
    expect(request.mock.calls).toContainEqual(["POST", { action: "reconcile", expectedGeneration: 0 }]);
    expect(client.getSnapshot().generation).toBe(1);
    expect(client.getSnapshot().message).toBe("Sharing stopped.");
  });

  it("keeps newer authority when a late Stop reconciliation returns an older replacement", async () => {
    client.setVisible(true); await settle();
    const oldReplacement = { ...own, sessionId: "20000000-0000-4000-8000-000000000001" };
    const newerOwn = { ...own, sessionId: "30000000-0000-4000-8000-000000000001" };
    let stopping = false;
    let reconciles = 0;
    let finishReconcile!: (value: FriendLocationRead) => void;
    request.mockImplementation((method, body) => {
      if (method === "DELETE") { stopping = true; return Promise.reject(new Error("conflict")); }
      if (method === "POST" && (body as { action?: string })?.action === "reconcile") {
        if (++reconciles === 1) return new Promise((resolve) => { finishReconcile = resolve; });
        return Promise.resolve({ ...read, generation: 3, own: newerOwn });
      }
      return Promise.resolve({ ...read, generation: 1, own: stopping ? null : own });
    });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    const stop = client.stop(); await settle();
    expect(reconciles).toBe(1);
    await client.refresh();
    expect(client.getSnapshot().generation).toBe(3);
    expect(client.getSnapshot().own).toEqual(newerOwn);
    finishReconcile({ ...read, generation: 2, own: oldReplacement });
    await stop;
    expect(client.getSnapshot().generation).toBe(3);
    expect(client.getSnapshot().own).toEqual(newerOwn);
    expect(client.getSnapshot().message).not.toBe("Sharing stopped.");
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("clears unconfirmed revoke after an authoritative read finds no active share", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    request.mockImplementation((method) => method === "DELETE"
      ? Promise.reject(new Error("connection lost after server revoke"))
      : Promise.resolve(read));
    await client.stop();
    expect(client.getSnapshot().status).toBe("revoke-error");
    await client.refresh();
    expect(client.getSnapshot().own).toBeNull();
    expect(client.getSnapshot().status).toBe("ready");
    expect(client.getSnapshot().message).not.toContain("unconfirmed");
  });

  it("keeps authoritative revoke confirmation when the older DELETE response later fails", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    let rejectRevoke!: (error: Error) => void;
    request.mockImplementation((method) => method === "DELETE"
      ? new Promise((_resolve, reject) => { rejectRevoke = reject; })
      : Promise.resolve(read));
    const stop = client.stop();
    await client.refresh();
    expect(client.getSnapshot().own).toBeNull();
    rejectRevoke(new Error("connection lost after server revoke")); await stop;
    expect(client.getSnapshot().status).toBe("ready");
    expect(client.getSnapshot().message).not.toContain("unconfirmed");
  });

  it("can reconnect the same controller after effect cleanup", async () => {
    client.setVisible(true); await settle();
    client.dispose();
    client.setVisible(true); await settle();
    expect(client.getSnapshot().status).toBe("ready");
  });

  it("checks permission before resuming and never prompts automatically", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    vi.mocked(geo.getCurrentPosition).mockClear(); vi.mocked(geo.watchPosition).mockClear();
    client.setVisible(false);
    permission.mockResolvedValue("prompt");
    client.setVisible(true); await settle();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(client.getSnapshot().status).toBe("paused");
  });

  it("requests a fresh visible fix after an authority heartbeat even when stationary", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(permission).toHaveBeenCalled();
  });

  it("aborts a coordinate update when page hides", async () => {
    client.setVisible(true); await settle();
    request.mockImplementation((method) => method === "PATCH" ? new Promise(() => {}) : Promise.resolve({ ...read, own }));
    const start = client.start(["mate"]); locate(position); await start; await settle();
    watch(position); await settle();
    const signal = request.mock.calls.find((args) => args[0] === "PATCH")?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    client.setVisible(false);
    expect(signal?.aborted).toBe(true);
  });

  it("clears expired point memory even while the next read is stalled", async () => {
    const friend = { profileId: "mate", handle: "bob", latitude: 51.5, longitude: -0.1, accuracy: 110, updatedAt: new Date().toISOString(), expiresAt: own.expiresAt };
    request.mockResolvedValueOnce({ ...read, friends: [friend] }).mockImplementation(() => new Promise(() => {}));
    client.setVisible(true); await settle();
    expect(client.getSnapshot().friends).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.getSnapshot().friends).toEqual([]);
  });

  it("does not resume geolocation for a replacement server session", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    vi.mocked(geo.getCurrentPosition).mockClear(); vi.mocked(geo.watchPosition).mockClear();
    request.mockResolvedValue({ ...read, own: { ...own, sessionId: "20000000-0000-4000-8000-000000000001" } });
    await client.refresh();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled(); expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(client.getSnapshot().status).toBe("paused");
  });

  it("does not retain foreground sharing authority after disposal", async () => {
    client.setVisible(true); await settle();
    request.mockResolvedValue({ ...read, own });
    const start = client.start(["mate"]); locate(position); await start; await settle();
    client.dispose();
    vi.mocked(geo.getCurrentPosition).mockClear(); vi.mocked(geo.watchPosition).mockClear();
    client.setVisible(true); await settle();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(client.getSnapshot().status).toBe("paused");
  });
});
