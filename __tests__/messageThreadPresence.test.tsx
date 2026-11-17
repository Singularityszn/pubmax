// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ bearer: "session-access-token", owns: true }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "presence-owner" } }) }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => account.bearer }));
vi.mock("@/lib/authProviderRevision", () => ({ providerOwnsSession: () => account.owns }));
vi.mock("@/lib/messageNotificationClient", () => ({ MESSAGE_NOTIFICATION_SETTINGS_CHANGED: "pubmax:message-notification-settings" }));
vi.mock("@/lib/messageNotificationLifecycle", () => ({
  currentMessagePushToken: async () => device,
  MESSAGE_PUSH_DEPARTURE: "pubmax:message-push-departure",
}));

import { useMessageThreadPresence as initialPresenceHook } from "@/components/messages/useMessageThreadPresence";
let usePresence = initialPresenceHook;
import { memoryMessageNotificationStore as store } from "@/lib/messageNotificationStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const device = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/presence-hook", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
type Presence = { conversationId: string | null; activityId: number; revision: number };
let requests: { body: Presence; authorization: string; complete: () => Promise<void> }[];
let holdReservations = false;
let reservations: { complete: () => Promise<void> }[];
let root: Root;
let host: HTMLDivElement;

function Thread({ id }: { id: string }) { usePresence(id); return null; }
async function render(id: string) {
  await act(async () => { root.render(createElement(Thread, { id })); });
}

beforeEach(async () => {
  usePresence = initialPresenceHook;
  requests = [];
  account.bearer = "session-access-token";
  account.owns = true;
  reservations = [];
  holdReservations = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ getNotifications: async () => [] }) } });
  await store.saveToken("presence-owner", device, "session");
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const parsed = JSON.parse(String(init.body));
    if (parsed.action === "presence-start") {
      const start = async () => Response.json({ activityId: await store.startPresence("presence-owner", device, "session") });
      if (!holdReservations) return start();
      return new Promise<Response>(resolve => { reservations.push({ complete: async () => resolve(await start()) }); });
    }
    return new Promise<Response>(resolve => {
      const body = parsed as Presence;
      requests.push({ body, authorization: new Headers(init.headers).get("authorization")!, complete: async () => {
      await store.presence("presence-owner", device, body.conversationId, "session", body.activityId, body.revision);
      resolve(Response.json({ ok: true }));
    } });
    });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await store.release(device);
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ordered thread presence requests", () => {
  it("keeps account departure terminal while the binding release is still pending", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    await act(async () => window.dispatchEvent(new Event("pubmax:message-push-departure")));
    await act(async () => requests.at(-1)!.complete());
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => requests.at(-1)!.complete());
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
  it("renews an older mounted client after another tab advanced the same device floor", async () => {
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    const otherTab = (await store.startPresence("presence-owner", device, "session"))!;
    await store.presence("presence-owner", device, "thread-b", "session", otherTab, 1);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => requests.at(-1)!.complete());
    expect(await store.targets("presence-owner", "thread-b")).toEqual([]);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => requests.at(-1)!.complete());
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
    expect(await store.targets("presence-owner", "thread-b")).toEqual([device]);
  });
  it("does not let a late unused reservation revoke a newer visible lifetime", async () => {
    holdReservations = true;
    await render("thread-a");
    await render("thread-b");
    await act(async () => reservations[1]!.complete());
    await act(async () => requests[0]!.complete());
    await act(async () => reservations[0]!.complete());
    expect(await store.targets("presence-owner", "thread-b")).toEqual([]);
    holdReservations = false;
    await act(async () => window.dispatchEvent(new Event("pubmax:message-notification-settings")));
    await act(async () => requests.at(-1)!.complete());
    expect(await store.targets("presence-owner", "thread-b")).toEqual([]);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
  it("does not close notifications after an obsolete notification read finishes", async () => {
    let finish!: (registration: unknown) => void;
    const registration = new Promise(resolve => { finish = resolve; });
    const alert = { closed: false, close() { this.closed = true; } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: () => registration } });
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    await render("thread-b");
    await act(async () => finish({ getNotifications: async () => [alert] }));
    expect(alert.closed).toBe(false);
    await act(async () => requests.at(-1)!.complete());
    expect(alert.closed).toBe(true);
  });
  it("renews at twenty seconds and cannot write after account departure", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    clock.mockReturnValue(120_000);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => requests.at(-1)!.complete());
    clock.mockReturnValue(140_000);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
    account.owns = false;
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    clock.mockReturnValue(150_001);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
  it("suppresses alerts after a backwards clock correction and a new client lifetime in the same session", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    await render("thread-a");
    await act(async () => requests.at(-1)!.complete());
    await act(async () => root.unmount());
    await act(async () => requests.at(-1)!.complete());
    clock.mockReturnValue(1_700_000_000_000);
    vi.resetModules();
    usePresence = (await import("@/components/messages/useMessageThreadPresence")).useMessageThreadPresence;
    root = createRoot(host);
    await render("thread-b");
    await act(async () => requests.at(-1)!.complete());
    expect(await store.targets("presence-owner", "thread-b")).toEqual([]);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await requests.at(-1)!.complete();
      await requests[0]!.complete();
    });
    expect(await store.targets("presence-owner", "thread-b")).toEqual([device]);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
  it("keeps B visible when A's heartbeat and departure complete afterwards", async () => {
    await render("thread-a");
    account.bearer = "replacement-access-token";
    await render("thread-b");
    expect(requests.map(request => request.body.conversationId)).toEqual(["thread-a", null, "thread-b"]);
    expect(requests[1]!.authorization).toBe("Bearer session-access-token");
    expect(requests[1]!.body.activityId).toBe(requests[0]!.body.activityId);
    expect(requests[2]!.body.activityId).toBeGreaterThan(requests[1]!.body.activityId);
    await act(async () => {
      await requests[2]!.complete();
      await requests[1]!.complete();
      await requests[0]!.complete();
    });
    expect(await store.targets("presence-owner", "thread-b")).toEqual([]);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
  it.each(["visibilitychange", "pagehide", "pubmax:message-push-departure"])("keeps %s authoritative over an in-flight visible heartbeat", async event => {
    await render("thread-a");
    await act(async () => {
      if (event === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event(event));
      } else window.dispatchEvent(new Event(event));
    });
    expect(requests.map(request => request.body.conversationId)).toEqual(["thread-a", null]);
    expect(requests[1]!.body.revision).toBeGreaterThan(requests[0]!.body.revision);
    await act(async () => { await requests[1]!.complete(); await requests[0]!.complete(); });
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
});
