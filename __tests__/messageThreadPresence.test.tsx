// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ bearer: "", owns: true, revision: 0, credentials: null as Promise<string | null> | null, subscription: null as Promise<string | null> | null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "presence-owner" } }) }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => account.credentials ?? account.bearer }));
vi.mock("@/lib/authProviderRevision", () => ({ providerOwnsSession: () => account.owns, readProviderAccountSignal: () => new AbortController().signal }));
vi.mock("@/lib/messageNotificationClient", () => ({ MESSAGE_NOTIFICATION_SETTINGS_CHANGED: "pubmax:message-notification-settings", MESSAGE_PUSH_RESTORED: "pubmax:message-push-restored" }));
vi.mock("@/lib/messageNotificationLifecycle", () => ({
  currentMessagePushToken: async () => account.subscription ?? device,
  messagePushDepartureRevision: () => account.revision,
  MESSAGE_PUSH_DEPARTURE: "pubmax:message-push-departure",
}));

import { useMessageThreadPresence as initialPresenceHook } from "@/components/messages/useMessageThreadPresence";
let usePresence = initialPresenceHook;
import { memoryMessageNotificationStore as store } from "@/lib/messageNotificationStore";
import { messageNotificationSessionFromToken } from "@/lib/messageNotificationSession";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const device = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/presence-hook", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
const SESSION = "11111111-1111-4111-8111-111111111111";
function bearer(sessionId = SESSION, refresh = 0) { return `header.${btoa(JSON.stringify({ sub: "presence-owner", session_id: sessionId, refresh }))}.signature`; }

type Presence = { conversationId: string | null; activityId: number; revision: number };
let requests: { body: Presence; authorization: string; complete: () => Promise<void> }[];
let holdReservations = false;
let holdBodies = false;
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
  account.bearer = bearer();
  account.credentials = null;
  account.subscription = null;
  account.revision = 0;
  account.owns = true;
  reservations = [];
  holdReservations = false;
  holdBodies = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ getNotifications: async () => [] }) } });
  await store.saveToken("presence-owner", device, SESSION, 1);
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const parsed = JSON.parse(String(init.body));
    const sessionId = messageNotificationSessionFromToken(new Headers(init.headers).get("authorization")!.slice(7), "presence-owner")!;
    if (parsed.action === "presence-start") {
      const start = async () => Response.json({ activityId: await store.startPresence("presence-owner", device, sessionId) });
      if (holdBodies) {
        const response = await start();
        const body = await response.json();
        return { ok: true, json: () => new Promise(resolve => { reservations.push({ complete: async () => resolve(body) }); }) };
      }
      if (!holdReservations) return start();
      return new Promise<Response>(resolve => { reservations.push({ complete: async () => resolve(await start()) }); });
    }
    return new Promise<Response>(resolve => {
      const body = parsed as Presence;
      requests.push({ body, authorization: new Headers(init.headers).get("authorization")!, complete: async () => {
        const applied = await store.presence("presence-owner", device, body.conversationId, sessionId, body.activityId, body.revision);
        resolve(Response.json({ ok: true, applied }));
      } });
    });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await store.release(device, Number.MAX_SAFE_INTEGER);
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deadlines() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Expired", "TimeoutError")), ms);
    return controller.signal;
  });
}
function restored(userId = "presence-owner", sessionId = SESSION, revision = account.revision) {
  window.dispatchEvent(new CustomEvent("pubmax:message-push-restored", { detail: { userId, sessionId, token: device, departureRevision: revision } }));
}

describe("ordered thread presence requests", () => {
  it.each(["reservation", "body", "auth", "subscription"])("recovers after a stalled %s stage and ignores its late completion", async stage => {
    deadlines();
    let finish!: () => void;
    if (stage === "reservation") holdReservations = true;
    if (stage === "body") holdBodies = true;
    if (stage === "auth") account.credentials = new Promise(resolve => { finish = () => resolve(bearer()); });
    if (stage === "subscription") account.subscription = new Promise(resolve => { finish = () => resolve(device); });
    await render("thread-a");
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    holdReservations = false;
    holdBodies = false;
    account.credentials = null;
    account.subscription = null;
    await act(async () => vi.advanceTimersByTimeAsync(17_000));
    expect(requests).toHaveLength(1);
    await act(async () => requests[0]!.complete());
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
    await act(async () => { if (finish) finish(); else await reservations[0]!.complete(); });
    expect(requests).toHaveLength(1);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
  });
  it.each(["visibilitychange", "pubmax:message-push-departure"])("fences a stalled body after %s", async event => {
    deadlines();
    holdBodies = true;
    await render("thread-a");
    await act(async () => {
      if (event === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event(event));
      } else window.dispatchEvent(new Event(event));
      await reservations[0]!.complete();
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(requests).toHaveLength(0);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
  });
  it("bounds tray reads and refuses to close a timed-out tray", async () => {
    deadlines();
    let finish!: (value: Notification[]) => void;
    const close = vi.fn();
    const tray = new Promise<Notification[]>(resolve => { finish = resolve; });
    const getNotifications = vi.fn(() => tray);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ getNotifications }) } });
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => requests.at(-1)!.complete());
    expect(getNotifications).toHaveBeenCalledTimes(1);
    await act(async () => finish([{ close } as unknown as Notification]));
    expect(close).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => requests.at(-1)!.complete());
    expect(getNotifications).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("uses one write per heartbeat and preserves suppression during bearer refresh", async () => {
    deadlines();
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    const before = vi.mocked(fetch).mock.calls.length;
    account.bearer = bearer(SESSION, 1);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(vi.mocked(fetch).mock.calls.length - before).toBe(1);
    expect(requests.map(request => request.body.conversationId)).toEqual(["thread-a", "thread-a"]);
    expect(requests[1]!.authorization).toBe(`Bearer ${account.bearer}`);
    expect(requests[1]!.body.activityId).toBe(requests[0]!.body.activityId);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
    await act(async () => requests[1]!.complete());
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
  });
  it("reserves for a different authenticated session and fences the old clear", async () => {
    deadlines();
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    const otherSession = "22222222-2222-4222-8222-222222222222";
    await store.saveToken("presence-owner", device, otherSession, 2);
    account.bearer = bearer(otherSession);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(requests.map(request => request.body.conversationId)).toEqual(["thread-a", null, "thread-a"]);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).action === "presence-start")).toHaveLength(2);
    await act(async () => { await requests[2]!.complete(); await requests[1]!.complete(); });
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
    expect(await store.presence("presence-owner", device, null, SESSION, requests[0]!.body.activityId, 100)).toBe(false);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
  });
  it("reserves again after another tab rejects the current lease", async () => {
    deadlines();
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    const other = (await store.startPresence("presence-owner", device, SESSION))!;
    await store.presence("presence-owner", device, "thread-b", SESSION, other, 1);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => requests[1]!.complete());
    expect(await store.targets("presence-owner", "thread-b")).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => requests[2]!.complete());
    expect(requests[2]!.body.activityId).toBeGreaterThan(other);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
  });
  it("resumes the same mounted thread only after confirmed original-account restoration", async () => {
    deadlines();
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    await act(async () => { account.revision++; window.dispatchEvent(new Event("pubmax:message-push-departure")); });
    await act(async () => requests[1]!.complete());
    await act(async () => {
      window.dispatchEvent(new Event("pubmax:message-notification-settings"));
      document.dispatchEvent(new Event("visibilitychange"));
      restored("other-account");
      restored("presence-owner", "22222222-2222-4222-8222-222222222222");
      restored("presence-owner", SESSION, account.revision - 1);
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(requests).toHaveLength(2);
    expect(await store.targets("presence-owner", "thread-a")).toEqual([device]);
    await act(async () => restored());
    await act(async () => requests[2]!.complete());
    expect(await store.targets("presence-owner", "thread-a")).toEqual([]);
  });
  it("never revives an account whose ownership was lost", async () => {
    await render("thread-a");
    await act(async () => requests[0]!.complete());
    await act(async () => window.dispatchEvent(new Event("pubmax:message-push-departure")));
    account.owns = false;
    await act(async () => restored());
    expect(requests).toHaveLength(2);
  });
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
    const otherTab = (await store.startPresence("presence-owner", device, SESSION))!;
    await store.presence("presence-owner", device, "thread-b", SESSION, otherTab, 1);
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
    account.bearer = bearer(SESSION, 1);
    await render("thread-b");
    expect(requests.map(request => request.body.conversationId)).toEqual(["thread-a", null, "thread-b"]);
    expect(requests[1]!.authorization).toBe(`Bearer ${bearer()}`);
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
