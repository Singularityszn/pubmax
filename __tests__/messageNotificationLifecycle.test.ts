// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseMessagePush, flushMessagePushReleases, recordMessagePushBinding } from "@/lib/messageNotificationLifecycle";
const account = vi.hoisted(() => ({ active: "A", owner: "", enabled: true, subscribe: null as null | ((signal?: AbortSignal | null) => Promise<Response>) }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: async (_url: string, init: RequestInit) => {
  if (init?.method === "POST") { if (account.subscribe) return account.subscribe(init.signal); account.owner = account.enabled ? account.active : ""; return Response.json({ ok: true, bound: account.enabled, sessionId: "22222222-2222-4222-8222-222222222222" }); }
  return Response.json({ enabled: account.enabled });
} }));
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { restoreMessagePushAccount } from "@/lib/messageNotificationClient";

const unsubscribe = vi.fn(async () => true);
const close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  account.subscribe = null;
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
