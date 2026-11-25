// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseMessagePush, flushMessagePushReleases, nextMessagePushSequence, recordMessagePushBinding, messagePushDepartureRevision } from "@/lib/messageNotificationLifecycle";
const account = vi.hoisted(() => ({ active: "A", owner: "", enabled: true, posts: [] as Record<string, unknown>[], subscribe: null as null | ((signal?: AbortSignal | null) => Promise<Response>) }));
vi.mock("@/lib/authProviderRevision", () => ({ providerOwnsSession: (_provider: string, userId: string) => account.active === userId, readProviderAccountSignal: () => new AbortController().signal }));
vi.mock("@/lib/authedFetch", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/authedFetch")>(), authedActionFetch: async (_url: string, init: RequestInit) => {
  if (init?.method === "POST") { account.posts.push(JSON.parse(String(init.body))); if (account.subscribe) return account.subscribe(init.signal); account.owner = account.enabled ? account.active : ""; return Response.json({ ok: true, bound: account.enabled, sessionId: "22222222-2222-4222-8222-222222222222" }); }
  return Response.json({ enabled: account.enabled });
} }));
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { restoreMessagePushAccount, saveMessageNotificationSetting, MESSAGE_PUSH_RESTORED } from "@/lib/messageNotificationClient";
import * as safeStorage from "@/lib/safeStorage";

function fullStorage(storage: Storage): Storage {
  return {
    get length() { return storage.length; },
    key: index => storage.key(index),
    getItem: key => storage.getItem(key),
    removeItem: key => storage.removeItem(key),
    clear: () => storage.clear(),
    setItem: () => { throw new DOMException("Full", "QuotaExceededError"); },
  };
}

const unsubscribe = vi.fn(async () => true);
const close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  account.subscribe = null;
  account.posts = [];
  account.active = "A";
  account.enabled = true;
  localStorage.clear();
  sessionStorage.clear();
  recordMessagePushBinding(encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/device", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!, "22222222-2222-4222-8222-222222222222");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
    getRegistration: async () => ({
      active: { scriptURL: "https://pubmaxxing.com/sw.js?cache-policy=plan-preview-safe-v2", postMessage: () => { throw new Error("Legacy worker does not acknowledge previews"); } },
      pushManager: { getSubscription: async () => ({ unsubscribe, toJSON: () => ({ endpoint: "https://web.push.apple.com/device", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } }) }) },
      getNotifications: async () => [{ data: { recipientId: "old-account" }, close }],
    }),
  } });
});
afterEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  await flushMessagePushReleases();
  vi.unstubAllGlobals();
});

describe("message alerts on account departure", () => {
  it("announces only a confirmed current-account restoration", async () => {
    const restored = vi.fn();
    window.addEventListener(MESSAGE_PUSH_RESTORED, restored);
    try {
      await releaseMessagePush();
      await restoreMessagePushAccount(new AbortController().signal, "A");
      expect(restored).toHaveBeenCalledTimes(1);
      expect(restored.mock.calls[0]![0].detail).toMatchObject({ userId: "A", sessionId: "22222222-2222-4222-8222-222222222222", departureRevision: messagePushDepartureRevision() });
      await releaseMessagePush();
      account.subscribe = async () => Response.json({ error: "unavailable" }, { status: 503 });
      await expect(restoreMessagePushAccount(new AbortController().signal, "A")).rejects.toThrow();
      expect(restored).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(MESSAGE_PUSH_RESTORED, restored); }
  });
  it("keeps the device order rising after a reload once a fast clock is corrected", () => {
    const issuedWhileFast = Date.now() + 3_600_000;
    localStorage.setItem("pubmax:message-push-sequence", String(issuedWhileFast));
    expect(nextMessagePushSequence()).toBeGreaterThan(issuedWhileFast);
  });
  it("orders a restore after the departure it follows, so a delayed detach cannot remove it", async () => {
    await releaseMessagePush();
    const detach = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body));
    await restoreMessagePushAccount(new AbortController().signal, "A");
    expect(account.posts).toEqual([expect.objectContaining({ action: "restore", sequence: expect.any(Number) })]);
    expect(account.posts[0]!.sequence).toBeGreaterThan(detach.sequence);
  });
  it("does not announce an obsolete restore after ownership changes", async () => {
    let finish!: (response: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    account.subscribe = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
    const restored = vi.fn();
    window.addEventListener(MESSAGE_PUSH_RESTORED, restored);
    try {
      const pending = restoreMessagePushAccount(new AbortController().signal, "A");
      await started;
      account.active = "B";
      const departure = releaseMessagePush();
      finish(Response.json({ ok: true, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" }));
      await Promise.all([pending, departure]);
      expect(restored).not.toHaveBeenCalled();
    } finally { window.removeEventListener(MESSAGE_PUSH_RESTORED, restored); }
  });
  it("detaches despite readable quota-full local storage containing an empty backlog", async () => {
    localStorage.setItem("pubmax:pending-message-detach", "[]");
    const write = vi.spyOn(safeStorage, "safeLocalStorage").mockReturnValue(fullStorage(localStorage));
    const detach = vi.mocked(fetch);
    try {
      await releaseMessagePush();
      expect(detach).toHaveBeenCalledWith("/api/message-notifications", expect.objectContaining({ method: "DELETE", body: expect.stringContaining("22222222-2222-4222-8222-222222222222") }));
    } finally { write.mockRestore(); }
    await flushMessagePushReleases();
    expect(localStorage.getItem("pubmax:pending-message-detach")).toBe("[]");
  });
  it("detaches an accepted binding when its session marker cannot be written", async () => {
    sessionStorage.clear();
    const write = vi.spyOn(safeStorage, "safeSessionStorage").mockReturnValue(fullStorage(sessionStorage));
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/device", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    try {
      const bound = nextMessagePushSequence();
      recordMessagePushBinding(token, "33333333-3333-4333-8333-333333333333", messagePushDepartureRevision(), bound);
      await releaseMessagePush();
      const init = vi.mocked(fetch).mock.calls.at(-1)![1]!;
      expect(init.method).toBe("DELETE");
      expect(JSON.parse(String(init.body))).toEqual({ token, sessionId: "33333333-3333-4333-8333-333333333333", sequence: expect.any(Number) });
      expect(JSON.parse(String(init.body)).sequence).toBeGreaterThan(bound);
    } finally { write.mockRestore(); }
  });
  it("releases a late accepted binding even when compensation cannot be persisted", async () => {
    const revision = messagePushDepartureRevision();
    await releaseMessagePush();
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/late-quota", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    const write = vi.spyOn(safeStorage, "safeLocalStorage").mockReturnValue(fullStorage(localStorage));
    try {
      recordMessagePushBinding(token, "33333333-3333-4333-8333-333333333333", revision, 41);
      await flushMessagePushReleases();
      expect(fetch).toHaveBeenCalledWith("/api/message-notifications", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ token, sessionId: "33333333-3333-4333-8333-333333333333", sequence: 42 }) }));
    } finally { write.mockRestore(); }
  });
  it("retains a late accepted binding for release without replacing the current device binding", async () => {
    const revision = messagePushDepartureRevision();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Offline"); }));
    await releaseMessagePush();
    const other = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/late-device", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    recordMessagePushBinding(other, "33333333-3333-4333-8333-333333333333", revision);
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toHaveLength(2);
    expect(sessionStorage.getItem("pubmax:message-device-binding")).toBeNull();
    recordMessagePushBinding(other, "44444444-4444-4444-8444-444444444444");
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toHaveLength(1);
    expect(JSON.parse(sessionStorage.getItem("pubmax:message-device-binding")!)).toEqual({ token: other, sessionId: "44444444-4444-4444-8444-444444444444" });
  });
  it("preserves a newer binding when an older detach finishes", async () => {
    let finish!: (response: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const sessions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      sessions.push(JSON.parse(String(init.body)).sessionId);
      if (sessions.length === 1) { entered(); return new Promise<Response>(resolve => { finish = resolve; }); }
      return Response.json({ ok: true });
    }));
    const departure = releaseMessagePush();
    await started;
    const token = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/device", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    recordMessagePushBinding(token, "33333333-3333-4333-8333-333333333333");
    finish(Response.json({ ok: true }));
    await departure;
    expect(JSON.parse(sessionStorage.getItem("pubmax:message-device-binding")!).sessionId).toBe("33333333-3333-4333-8333-333333333333");
    await releaseMessagePush();
    expect(sessions).toEqual(["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]);
  });
  it.each(["restore", "subscribe"] as const)("does not let a delayed %s erase the detach after departure", async operation => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    const subscription = await registration.pushManager.getSubscription();
    vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue(registration);
    let resume!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    if (operation === "restore") vi.spyOn(registration, "getNotifications").mockImplementationOnce(async () => { entered(); await held; return []; });
    else vi.spyOn(registration.pushManager, "getSubscription").mockImplementationOnce(async () => { entered(); await held; return subscription; });
    const write = vi.fn(async () => { account.owner = "A"; return Response.json({ bound: true, sessionId: "22222222-2222-4222-8222-222222222222" }); });
    account.subscribe = write;
    account.owner = "A";
    vi.stubGlobal("fetch", vi.fn(async () => { account.owner = ""; return Response.json({ ok: true }); }));
    const token = encodeWebPushSubscription(subscription!.toJSON())!;
    const work = (operation === "restore" ? restoreMessagePushAccount(new AbortController().signal, "A") : saveMessageNotificationSetting({ action: "subscribe", token })).catch(() => undefined);
    await started;
    const departure = releaseMessagePush();
    resume();
    try {
      await Promise.all([work, departure]);
      expect(write).not.toHaveBeenCalled();
      expect(account.owner).toBe("");
      expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toEqual([]);
    } finally { vi.restoreAllMocks(); }
  });
  it("closes legacy private notifications while a detach waits for its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    try {
      const departure = releaseMessagePush();
      await vi.advanceTimersByTimeAsync(3_000);
      await departure;
      expect(close).toHaveBeenCalledOnce();
      expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it("binds even while notification tray access remains unavailable", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    const registration = (await navigator.serviceWorker.getRegistration())!;
    vi.spyOn(registration, "getNotifications").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue(registration);
    account.active = "B";
    account.owner = "A";
    account.enabled = true;
    const restoring = restoreMessagePushAccount(new AbortController().signal, "B").catch(() => undefined);
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      await restoring;
      expect(account.owner).toBe("B");
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); timeout.mockRestore(); vi.useRealTimers(); }
  });
  it.each([
    ["restore", "registration"], ["restore", "tray"],
    ["release", "registration"], ["release", "tray"],
  ] as const)("recovers the queue after %s stalls on %s access", async (operation, method) => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    const registration = (await navigator.serviceWorker.getRegistration())!;
    let unblock!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const stalled = new Promise<void>(resolve => { unblock = resolve; });
    const intercept = method === "registration"
      ? vi.spyOn(navigator.serviceWorker, "getRegistration").mockImplementationOnce(async () => { started(); await stalled; return registration; })
      : vi.spyOn(registration, "getNotifications").mockImplementationOnce(async () => { started(); await stalled; return []; });
    if (method === "tray") vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue(registration);
    account.active = "A";
    account.enabled = true;
    account.owner = "A";
    const first = (operation === "restore" ? restoreMessagePushAccount(new AbortController().signal, "A") : releaseMessagePush()).catch(() => undefined);
    await entered;
    const departure = operation === "restore" ? releaseMessagePush() : first;
    account.active = "B";
    let rebound = false;
    const next = restoreMessagePushAccount(new AbortController().signal, "B").then(() => { rebound = true; });
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      await departure;
      expect(rebound).toBe(true);
      expect(account.owner).toBe("B");
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally {
      unblock();
      await Promise.allSettled([first, departure, next]);
      intercept.mockRestore();
      vi.restoreAllMocks();
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
  it("ends a stalled preference save within three seconds and preserves caller cancellation", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    const controller = new AbortController();
    const failed = vi.fn();
    account.subscribe = (signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("The fetch was aborted.", "AbortError")), { once: true });
    });
    const saving = saveMessageNotificationSetting({ action: "preferences", enabled: true, preview: false }, controller.signal).catch(failed);
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ name: "TimeoutError" }));
      expect(controller.signal.aborted).toBe(false);
    } finally {
      controller.abort();
      await saving;
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
  it("restores ownership after A to B to A without another permission prompt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { account.owner = ""; return Response.json({ ok: true }); }));
    account.enabled = true;
    for (const active of ["A", "B", "A"]) {
      account.active = active;
      await restoreMessagePushAccount(new AbortController().signal, active);
      expect(account.owner).toBe(active);
    }
    account.active = "B";
    account.enabled = false;
    await restoreMessagePushAccount(new AbortController().signal, account.active);
    expect(account.owner).toBe("");
  });
  it.each([401, 429])("does not revoke a public subscription after a definitive %i restore refusal", async (status) => {
    account.subscribe = async () => new Response(null, { status });
    await expect(restoreMessagePushAccount(new AbortController().signal, "A")).rejects.toThrow();
    account.subscribe = null;
    await restoreMessagePushAccount(new AbortController().signal, "A");
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("keeps the public browser subscription through a failed restore and departure", async () => {
    account.enabled = true;
    account.subscribe = async () => { throw new TypeError("Offline"); };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    await expect(restoreMessagePushAccount(new AbortController().signal, "A")).rejects.toThrow();
    expect(unsubscribe).not.toHaveBeenCalled();
    await releaseMessagePush();
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("does not send another detach on a signed-out reload without a binding", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await releaseMessagePush();
    const count = fetch.mock.calls.length;
    await releaseMessagePush();
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it("rebinds the current token despite a failed superseded detach", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })));
    await releaseMessagePush();
    account.enabled = true;
    account.active = "B";
    await expect(restoreMessagePushAccount(new AbortController().signal, "B")).resolves.toBeUndefined();
    expect(account.owner).toBe("B");
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toEqual([]);
  });
  it("waits for an accepted subscription before releasing it on departure", async () => {
    let finish!: () => void;
    let started!: () => void;
    const accepted = new Promise<void>((resolve) => { started = resolve; });
    account.active = "A";
    account.enabled = true;
    let subscriptionSignal: AbortSignal | null | undefined;
    account.subscribe = async (signal) => {
      subscriptionSignal = signal;
      started();
      await new Promise<void>((resolve) => { finish = resolve; });
      account.owner = "A";
      return Response.json({ ok: true, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" });
    };
    vi.stubGlobal("fetch", vi.fn(async () => { account.owner = ""; return Response.json({ ok: true }); }));
    const controller = new AbortController();
    const restoring = restoreMessagePushAccount(controller.signal, "A");
    await accepted;
    controller.abort();
    const departing = releaseMessagePush();
    try { expect(subscriptionSignal?.aborted).toBe(false); } finally { finish(); await Promise.all([restoring, departing]); }
    expect(account.owner).toBe("");
  });
  it("releases a legacy worker without requiring the new preview acknowledgement and closes old notifications without using CacheStorage", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("caches", { open: () => { throw new Error("storage unavailable"); } });
    await releaseMessagePush();
    expect(fetch).toHaveBeenCalledWith("/api/message-notifications", expect.objectContaining({ method: "DELETE", keepalive: true }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("completes offline departure and retries only the message detach on next contact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Offline"); }));
    await expect(releaseMessagePush()).resolves.toBeUndefined();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toHaveLength(1);
    const recovered = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", recovered);
    await flushMessagePushReleases();
    expect(recovered).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toEqual([]);
  });
  it("drops a permanently invalid detach and still releases the next device", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Offline"); }));
    await releaseMessagePush();
    const other = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/other-device", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
    recordMessagePushBinding(other, "33333333-3333-4333-8333-333333333333");
    await releaseMessagePush();
    let released = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { released++; return released === 1 ? new Response(null, { status: 400 }) : Response.json({ ok: true }); }));
    await flushMessagePushReleases();
    expect(released).toBe(2);
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toEqual([]);
  });
  it.each([408, 200])("retains a detach after a transient or captive-portal %i response", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Pub Wi-Fi sign in", { status })));
    await releaseMessagePush();
    expect(JSON.parse(localStorage.getItem("pubmax:pending-message-detach")!)).toHaveLength(1);
  });
  it("does not wait longer than three seconds for an unresponsive preview worker", async () => {
    vi.useFakeTimers();
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => ({ ...registration, active: { scriptURL: "https://pubmaxxing.com/sw.js?message-previews=1", postMessage: vi.fn() } }), configurable: true });
      vi.stubGlobal("MessageChannel", class { port1 = { close() {}, onmessage: null }; port2 = {}; });
      const departing = releaseMessagePush();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(departing).resolves.toBeUndefined();
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
