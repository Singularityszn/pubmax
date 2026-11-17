import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

type Listener = (event: unknown) => void;

function workerHarness(options: { userId?: string; subscription?: Promise<null | { toJSON: () => unknown }>; windows?: Array<{ url: string; visibilityState: string; postMessage: ReturnType<typeof vi.fn> }> } = {}) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const fakeSelf = {
    location: { href: "https://pubmaxxing.com/sw.js?v=test&message-previews=1", origin: "https://pubmaxxing.com" },
    registration: { showNotification, pushManager: { getSubscription: () => options.subscription ?? Promise.resolve(null) } },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => options.windows ?? (options.subscription ? [{ url: "https://pubmaxxing.com/messages", visibilityState: "visible", postMessage: vi.fn((data, ports) => { if (data.type === "pubmax:message-preview-auth") ports[0].postMessage({ token: "current-session" }); }) }] : [])),
      openWindow,
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const fakeCaches = { open: vi.fn(async () => ({ match: async () => Response.json({ userId: options.userId }) })), keys: vi.fn() };
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  Function("self", "caches", source)(fakeSelf, fakeCaches);
  return { listeners, showNotification, openWindow, clients: fakeSelf.clients };
}

describe("service worker web push", () => {
  it("discards a preview authorised before account departure and acknowledges after display", async () => {
    let resolvePreview!: (response: Response) => void;
    let requested!: () => void;
    const raw = { endpoint: "https://web.push.apple.com/device", expirationTime: null, keys: { p256dh: "public_key_material", auth: "secret_auth_material" } };
    const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).token).toBe(encodeWebPushSubscription(raw));
      requested();
      return new Promise<Response>((resolve) => { resolvePreview = resolve; });
    }));
    try {
      const { listeners, showNotification } = workerHarness({ subscription: Promise.resolve({ toJSON: () => raw }) });
      let pending = Promise.resolve();
      let departing = Promise.resolve();
      const acknowledge = vi.fn();
      listeners.get("push")!({
        data: { json: () => ({ title: "New message", body: "Open PubMaxxing to read it.", data: { kind: "message", preview: "1", recipientId: "A", url: "/messages/thread" } }) },
        waitUntil(value: Promise<void>) { pending = value; },
      });
      await requestStarted;
      listeners.get("message")!({ data: { type: "pubmax:message-push-departure" }, ports: [{ postMessage: acknowledge }], waitUntil(value: Promise<void>) { departing = value; } });
      resolvePreview(Response.json({ preview: { title: "@sender", body: "A private message" } }));
      await Promise.all([pending, departing]);
      expect(showNotification).toHaveBeenCalledWith("New message", expect.objectContaining({ body: "Open PubMaxxing to read it." }));
      expect(acknowledge).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it("still displays the generic alert when the native preview lookup never settles", async () => {
    vi.useFakeTimers();
    try {
      const { listeners, showNotification } = workerHarness({ subscription: new Promise(() => undefined) });
      let pending = Promise.resolve();
      listeners.get("push")!({
        data: { json: () => ({ title: "New message", body: "Open PubMaxxing to read it.", data: { kind: "message", preview: "1", recipientId: "recipient", url: "/messages/thread" } }) },
        waitUntil(value: Promise<void>) { pending = value; },
      });
      await vi.advanceTimersByTimeAsync(1_500);
      await pending;
      expect(showNotification).toHaveBeenCalledWith("New message", expect.objectContaining({ body: "Open PubMaxxing to read it." }));
    } finally { vi.useRealTimers(); }
  });
  it("opens a message thread in the existing app window", async () => {
    const { listeners, clients, openWindow } = workerHarness();
    const focus = vi.fn();
    const navigate = vi.fn();
    clients.matchAll.mockImplementation(async () => [Object.assign({ url: "https://pubmaxxing.com/map", visibilityState: "visible", postMessage: vi.fn() }, { focus, navigate })]);
    let pending = Promise.resolve();
    listeners.get("notificationclick")!({
      notification: { close: vi.fn(), data: { recipientId: "recipient", url: "/messages/11111111-1111-4111-8111-111111111111" } },
      waitUntil(value: Promise<void>) { pending = value; },
    });
    await pending;
    expect(navigate).toHaveBeenCalledWith("https://pubmaxxing.com/messages/11111111-1111-4111-8111-111111111111");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });
  it("always shows a received message push, including after an account change", async () => {
    for (const userId of [undefined, "different-account", "recipient"]) {
      const { listeners, showNotification } = workerHarness({ userId });
      let pending = Promise.resolve();
      listeners.get("push")!({
        data: { json: () => ({ title: "New message", body: "Open PubMaxxing to read it.", data: { kind: "message", recipientId: "recipient", url: "/messages/thread-1" } }) },
        waitUntil(value: Promise<void>) { pending = value; },
      });
      await pending;
      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tag: "message:thread-1", renotify: false }));
    }
  });

  it.each(["/messages/thread-1", "/map"])("signals a visible app at %s and fulfils userVisibleOnly", async (path) => {
    const postMessage = vi.fn();
    const { listeners, showNotification } = workerHarness({ userId: "recipient", windows: [{ url: `https://pubmaxxing.com${path}`, visibilityState: "visible", postMessage }] });
    let pending = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => ({ data: { kind: "message", recipientId: "recipient", url: "/messages/thread-1" } }) },
      waitUntil(value: Promise<void>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "pubmax:message-arrival", recipientId: "recipient" });
  });

  it("shows a payload and reduces external click-through to /today", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => ({
        title: "Today in London",
        body: "Warm and dry.",
        tag: "daily-brief",
        data: { url: "https://evil.example/steal" },
      }) },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("Today in London", expect.objectContaining({
      body: "Warm and dry.",
      tag: "daily-brief",
      data: { url: "/today" },
    }));
  });

  it("reduces a dot-segment path that resolves off-site to /today", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => ({ title: "Today in London", data: { url: "/..//evil.example/x" } }) },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("Today in London", expect.objectContaining({
      data: { url: "/today" },
    }));
  });

  it("shows a useful fallback for a malformed push", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => { throw new Error("bad json"); } },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("PUBMAXX", expect.objectContaining({
      body: "Your London brief is ready.",
      data: { url: "/today" },
    }));
  });

  it.each([null, [], "text", 42])(
    "normalizes non-object JSON payload %j to the fallback",
    async (payload) => {
      const { listeners, showNotification } = workerHarness();
      let pending: Promise<unknown> = Promise.resolve();
      listeners.get("push")!({
        data: { json: () => payload },
        waitUntil(value: Promise<unknown>) { pending = value; },
      });
      await pending;
      expect(showNotification).toHaveBeenCalledWith("PUBMAXX", expect.objectContaining({
        body: "Your London brief is ready.",
        data: { url: "/today" },
      }));
    },
  );

  it("normalizes array notification data instead of reading array properties", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    const data: unknown[] & { url?: string } = [];
    data.url = "/should-not-open";
    listeners.get("push")!({
      data: { json: () => ({ data }) },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("PUBMAXX", expect.objectContaining({
      data: { url: "/today" },
    }));
  });

  it("opens only a same-origin URL when the notification is clicked", async () => {
    const { listeners, openWindow } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.get("notificationclick")!({
      notification: { data: { url: "/tonight?from=push" }, close },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith("https://pubmaxxing.com/tonight?from=push");
  });
});
