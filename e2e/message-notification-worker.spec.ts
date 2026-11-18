import { chromium, expect, test } from "@playwright/test";

test("the real Chromium worker displays and collapses dispatched message pushes", async ({ baseURL }, testInfo) => {
  const context = await chromium.launchPersistentContext(testInfo.outputPath("notification-profile"), { baseURL, channel: "chromium", headless: process.env.PW_MESSAGE_PUSH_HEADED !== "1" });
  const page = context.pages()[0];
  try {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseURL && ["/", "/map", "/tonight"].includes(url.pathname)) {
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Public offline shell fixture</title>" });
      }
      return route.continue();
    });
    await page.goto("/offline.html");
    await context.grantPermissions(["notifications"], { origin: new URL(page.url()).origin });
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js?v=message-notification-proof&message-previews=1");
      await navigator.serviceWorker.ready;
    });
    const worker = context.serviceWorkers().find((candidate) => candidate.url().includes("/sw.js"));
    expect(worker).toBeDefined();
    const permission = await worker!.evaluate(() => ({ origin: self.location.origin, permission: Notification.permission }));
    await testInfo.attach("worker-permission.json", { body: Buffer.from(JSON.stringify({ pageOrigin: new URL(page.url()).origin, ...permission })), contentType: "application/json" });
    const platformCount = await worker!.evaluate(async () => {
      const { registration } = self as unknown as { registration: ServiceWorkerRegistration };
      await registration.showNotification("Notification API probe", { tag: "platform-probe" });
      const notifications = await registration.getNotifications({ tag: "platform-probe" });
      for (const notification of notifications) notification.close();
      return notifications.length;
    });
    await testInfo.attach("platform-probe.json", { body: Buffer.from(JSON.stringify({ platformCount })), contentType: "application/json" });
    expect(platformCount).toBe(1);
    const payload = { title: "New message", body: "Open PubMaxxing to read it.", tag: "message:thread-proof", data: { kind: "message", recipientId: "recipient-proof", url: "/messages/thread-proof" } };
    const dispatch = (data: typeof payload) => worker!.evaluate((data) => {
      const scope = self as unknown as { PushEvent: new (type: string, init: { data: string }) => Event; dispatchEvent(event: Event): boolean };
      scope.dispatchEvent(new scope.PushEvent("push", { data: JSON.stringify(data) }));
    }, data);
    const read = () => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return (await registration?.getNotifications() ?? []).map((notification) => ({ title: notification.title, body: notification.body, tag: notification.tag, data: notification.data }));
    });
    await dispatch(payload);
    await expect.poll(read).toEqual([{ title: payload.title, body: payload.body, tag: payload.tag, data: { url: payload.data.url, recipientId: payload.data.recipientId } }]);
    await dispatch({ ...payload, body: "Another message is waiting." });
    await expect.poll(read).toEqual([{ title: payload.title, body: "Another message is waiting.", tag: payload.tag, data: { url: payload.data.url, recipientId: payload.data.recipientId } }]);
    await page.evaluate(() => navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "pubmax:message-preview-auth") event.ports[0].postMessage({ token: "fixture-current-session" });
    }));
    await worker!.evaluate(async () => {
      const scope = self as unknown as { fetch: typeof fetch; registration: ServiceWorkerRegistration; dispatchEvent(event: Event): boolean };
      const originalFetch = scope.fetch;
      const manager = scope.registration.pushManager;
      const originalSubscription = manager.getSubscription.bind(manager);
      let finish!: () => void;
      let requested!: () => void;
      const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
      manager.getSubscription = async () => ({ toJSON: () => ({ endpoint: "https://web.push.apple.com/proof", keys: { p256dh: "public_key_material", auth: "secret_auth_material" } }) }) as unknown as PushSubscription;
      scope.fetch = async () => {
        requested();
        await new Promise<void>((resolve) => { finish = resolve; });
        return Response.json({ preview: { title: "@sender", body: "A private message" } });
      };
      try {
        scope.dispatchEvent(new (self as unknown as { PushEvent: new (type: string, init: { data: string }) => Event }).PushEvent("push", { data: JSON.stringify({ title: "New message", body: "Open PubMaxxing to read it.", data: { kind: "message", preview: "1", recipientId: "departed-account", url: "/messages/departure-proof" } }) }));
        await requestStarted;
        const channel = new MessageChannel();
        const acknowledged = new Promise<void>((resolve) => { channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; });
        scope.dispatchEvent(new (self as unknown as { ExtendableMessageEvent: new (type: string, init: { data: unknown; ports: MessagePort[] }) => Event }).ExtendableMessageEvent("message", { data: { type: "pubmax:message-push-departure" }, ports: [channel.port2] }));
        finish();
        await acknowledged;
      } finally {
        scope.fetch = originalFetch;
        manager.getSubscription = originalSubscription;
      }
    });
    await expect.poll(read).toContainEqual({ title: "New message", body: "Open PubMaxxing to read it.", tag: "message:departure-proof", data: { url: "/messages/departure-proof", recipientId: "departed-account" } });
    expect((await read()).some((notification) => notification.body === "A private message")).toBe(false);
    await testInfo.attach("notification-records.json", { body: Buffer.from(JSON.stringify(await read(), null, 2)), contentType: "application/json" });
  } finally {
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      for (const notification of await registration?.getNotifications() ?? []) notification.close();
      await registration?.unregister();
    }).catch(() => undefined);
    await context.close();
  }
});
