// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ bearer: "session-access-token" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "presence-owner" } }) }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => account.bearer }));
vi.mock("@/lib/authProviderRevision", () => ({ providerOwnsSession: () => true }));
vi.mock("@/lib/messageNotificationClient", () => ({ MESSAGE_NOTIFICATION_SETTINGS_CHANGED: "pubmax:message-notification-settings" }));
vi.mock("@/lib/messageNotificationLifecycle", () => ({
  currentMessagePushToken: async () => device,
  MESSAGE_PUSH_DEPARTURE: "pubmax:message-push-departure",
}));

import { useMessageThreadPresence } from "@/components/messages/useMessageThreadPresence";
import { memoryMessageNotificationStore as store } from "@/lib/messageNotificationStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const device = encodeWebPushSubscription({ endpoint: "https://web.push.apple.com/presence-hook", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } })!;
type Presence = { conversationId: string | null; activityId: number; revision: number };
let requests: { body: Presence; authorization: string; complete: () => Promise<void> }[];
let root: Root;
let host: HTMLDivElement;

function Thread({ id }: { id: string }) { useMessageThreadPresence(id); return null; }
async function render(id: string) {
  await act(async () => { root.render(createElement(Thread, { id })); });
}

beforeEach(async () => {
  requests = [];
  account.bearer = "session-access-token";
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ getNotifications: async () => [] }) } });
  await store.saveToken("presence-owner", device, "session");
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>(resolve => {
    const body = JSON.parse(String(init.body)) as Presence;
    requests.push({ body, authorization: new Headers(init.headers).get("authorization")!, complete: async () => {
      await store.presence("presence-owner", device, body.conversationId, "session", body.activityId, body.revision);
      resolve(Response.json({ ok: true }));
    } });
  })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await store.release(device);
  host.remove();
  vi.unstubAllGlobals();
});

describe("ordered thread presence requests", () => {
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
