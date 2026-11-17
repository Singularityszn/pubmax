import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn as seedFixtureSignedIn, switchRememberedAccount } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

const THREAD = "11111111-1111-4111-8111-111111111111";

async function seedSignedIn(page: Page, account: "A" | "B"): Promise<void> {
  await seedFixtureSignedIn(page, account);
  await page.reload();
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS[account].name}`, exact: true })).toBeVisible();
}

async function pushRuntime(page: Page, legacy = false): Promise<void> {
  await page.addInitScript((legacy) => {
    let requests = 0;
    let closed = 0;
    let unsubscribed = 0;
    class Permission {
      static permission = "default";
      static async requestPermission() { requests++; Permission.permission = "granted"; return "granted"; }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: Permission });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    const events = new EventTarget();
    const subscription = { unsubscribe: async () => { unsubscribed++; return true; }, toJSON: () => ({ endpoint: "https://web.push.apple.com/message-e2e", keys: { p256dh: "e2ePublicKey_material", auth: "e2eAuthKey_material" } }) };
    const registration = {
      active: { scriptURL: `${location.origin}/sw.js${legacy ? "" : "?message-previews=1"}`, postMessage(_data: unknown, ports: MessagePort[]) { ports[0].postMessage({ ok: true }); } },
      pushManager: { getSubscription: async () => (window as unknown as { __hangMessageSubscription?: boolean }).__hangMessageSubscription ? new Promise(() => {}) : subscription, subscribe: async () => subscription },
      getNotifications: async () => (window as unknown as { __hangMessageTray?: boolean }).__hangMessageTray ? new Promise(() => {}) : [{ data: { recipientId: "previous-account" }, close() { closed++; } }],
    };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      getRegistration: async () => (window as unknown as { __hangMessageRegistration?: boolean }).__hangMessageRegistration ? new Promise(() => {}) : registration, register: async () => registration, ready: Promise.resolve(registration),
    } });
    Object.defineProperty(window, "__permissionRequests", { get: () => requests });
    Object.defineProperty(window, "__unsubscribedPush", { get: () => unsubscribed });
    Object.defineProperty(window, "__closedNotifications", { get: () => closed });
    Object.defineProperty(window, "__receiveMessage", { value: (recipientId: string) => events.dispatchEvent(new MessageEvent("message", { data: { type: "pubmax:message-arrival", recipientId } })) });
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  }, legacy);
}

test("a recipient can choose message alerts without enabling public broadcasts", async ({ page, browserName }, testInfo) => {
  await storeThemeChoice(page, "light");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await installAuthDoubles(page);
  await pushRuntime(page);
  await seedSignedIn(page, "B");
  await auth.signedInAs("B");
  await page.goto("about:blank");
  await page.route("**/api/messages?**", (route) => route.fulfill({ json: {
    conversations: [{
      id: THREAD,
      otherHandle: ACCOUNTS.A.handle,
      lastBody: "Meet at the Lamb at seven?",
      lastAt: new Date().toISOString(),
      lastFromMe: false,
      unread: 1,
    }],
  } }));
  let preferences = { enabled: false, preview: false, muted: false, registered: false };
  const actions: string[] = [];
  let stallNextSave = false;
  let loseBindingOnSave = false;
  await page.route("**/api/message-notifications**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      actions.push(body.action);
      if (body.action === "preferences" && stallNextSave) { stallNextSave = false; if (loseBindingOnSave) preferences.registered = false; return; }
      if (body.action === "subscribe") preferences.registered = true;
      if (body.action === "preferences") preferences = { ...preferences, enabled: body.enabled, preview: body.preview };
      await route.fulfill({ json: { ok: true, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" } });
    } else await route.fulfill({ json: preferences });
  });
  await page.route("**/api/push-tokens", () => { throw new Error("Message consent must not register public broadcasts"); });
  await page.goto("/messages");
  await expect(page.getByRole("link", { name: /Meet at the Lamb/ })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`recipient-${width}.png`), fullPage: true });
  }
  await expect(page.getByRole("button", { name: "Message notifications", exact: true })).toBeVisible();
  await page.setViewportSize({ width: testInfo.project.name.includes("iphone") ? 390 : 1440, height: 900 });
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  await expect(page.getByRole("button", { name: "Turn on message alerts", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("permission-before-tap.png"), fullPage: true });
  await page.getByRole("button", { name: "Turn on message alerts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Turn off alerts on all devices", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(1);
  expect(actions).toEqual(["restore", "subscribe", "preferences"]);
  expect(preferences.preview).toBe(false);
  await page.getByRole("checkbox", { name: /Show the sender/ }).check();
  await expect.poll(() => preferences.preview).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("permission-enabled.png"), fullPage: true });
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme`, exact: true });
    if (await toggle.count()) {
      await toggle.click();
      await expect(page.getByRole("region", { name: "Message alerts", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Message notifications", exact: true }).click();
      await expect(page.getByRole("region", { name: "Message alerts", exact: true })).toHaveAttribute("aria-busy", "false");
    }
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const panel = page.getByRole("region", { name: "Message alerts", exact: true });
      await expect(panel).toBeVisible();
      await expect.poll(() => panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`alerts-${theme}-${width}.png`), scale: "css" });
    }
  }
  const preview = page.getByRole("checkbox", { name: /Show the sender/ });
  stallNextSave = true;
  await preview.focus();
  await expect(preview).toBeFocused();
  await preview.press("Space");
  await expect(page.getByRole("region", { name: "Message alerts", exact: true })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Could not confirm your change. Check the setting and try again.", { exact: true })).toBeVisible();
  await expect(preview).toBeChecked();
  await expect(preview).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("stalled-save-recovered.png"), scale: "css" });
  await preview.uncheck();
  await expect.poll(() => preferences.preview).toBe(false);
  await expect(page.getByRole("region", { name: "Message alerts", exact: true })).toHaveAttribute("aria-busy", "false");
  const disable = page.getByRole("button", { name: "Turn off alerts on all devices", exact: true });
  await disable.focus();
  await disable.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(preview).toBeFocused();
  preferences.registered = false;
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  const activate = page.getByRole("button", { name: "Turn on alerts on this device", exact: true });
  await expect(activate).toBeVisible();
  stallNextSave = true;
  loseBindingOnSave = true;
  await activate.click();
  await expect(page.getByText("Could not confirm your change. Check the setting and try again.", { exact: true })).toBeVisible();
  await expect(activate).toBeVisible();
  expect(preferences.registered).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("device-activation-not-confirmed.png"), scale: "css" });
  await disable.click();
  await expect.poll(() => preferences.enabled).toBe(false);
});

test("an incoming message updates the badge, opens its thread and stays quiet inside it", async ({ page, browser, baseURL }, testInfo) => {
  await pushRuntime(page);
  const recipient = await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  await recipient.signedInAs("B");
  await page.goto("about:blank");
  let unread = 1;
  let body = "See you at seven";
  let stamp = "2026-11-16T21:00:00Z";
  let inboxReads = 0;
  const pendingInbox = new Set<unknown>();
  page.on("request", (request) => { if (request.url().includes("/api/messages?")) pendingInbox.add(request); });
  page.on("requestfinished", (request) => pendingInbox.delete(request));
  page.on("requestfailed", (request) => pendingInbox.delete(request));
  const rows = () => [{ id: THREAD, otherHandle: ACCOUNTS.A.handle, lastBody: body, lastAt: stamp, lastFromMe: false, unread }];
  await page.route("**/api/messages?**", (route) => { inboxReads++; return route.fulfill({ json: { conversations: rows() } }); });
  await page.route("**/api/message-notifications**", (route) => route.fulfill({ json: { enabled: true, preview: false, muted: false, quiet: false, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" } }));
  await page.route(`**/api/messages/${THREAD}**`, (route) => route.fulfill({ json: { messages: [{ id: "m1", conversationId: THREAD, senderHandle: ACCOUNTS.A.handle, body, createdAt: "2026-11-16T22:00:00Z", read: true, flagged: false }] } }));
  const senderContext = await browser.newContext({ baseURL });
  try {
    const sender = await senderContext.newPage();
    const auth = await installAuthDoubles(sender);
    await seedSignedIn(sender, "A");
    await auth.signedInAs("A");
    await sender.route("**/api/messages?**", (route) => route.fulfill({ json: { conversations: [{ ...rows()[0], otherHandle: ACCOUNTS.B.handle }] } }));
    await sender.route(`**/api/messages/${THREAD}**`, async (route) => {
      if (route.request().method() === "POST") {
        body = route.request().postDataJSON().body;
        unread = 2;
        stamp = "2026-11-16T22:00:00Z";
        await route.fulfill({ json: { message: { id: "m2", conversationId: THREAD, senderHandle: ACCOUNTS.A.handle, body, createdAt: "2026-11-16T22:00:00Z", read: false, flagged: false } } });
      } else await route.fulfill({ json: { messages: [] } });
    });
    await sender.goto(`/messages/${THREAD}`);
    await expect(sender.getByRole("textbox", { name: /message/i })).toBeVisible();
    await page.goto("/messages");
    await expect(page.getByRole("link", { name: /See you at seven/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Messages, 1 unread", exact: true })).toBeVisible();
    await sender.getByRole("textbox", { name: /message/i }).fill("The Lamb works for me");
    await sender.getByRole("button", { name: "Send", exact: true }).click();
    await expect(sender.locator(".threadMessages").getByText("The Lamb works for me", { exact: true })).toBeVisible();
    await sender.screenshot({ path: testInfo.outputPath("sender-sent.png"), fullPage: true });
    await page.bringToFront();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => pendingInbox.size).toBe(0);
    const readsBeforeArrival = inboxReads;
    await page.evaluate((id) => (window as unknown as { __receiveMessage: (id: string) => void }).__receiveMessage(id), ACCOUNTS.B.id);
    await expect(page.getByRole("link", { name: "Messages, 2 unread", exact: true })).toBeVisible();
    await expect(page.locator(`a.conversationLink[href="/messages/${THREAD}"] .conversationUnread`)).toHaveAttribute("aria-label", "2 unread");
    expect(inboxReads).toBe(readsBeforeArrival + 1);
    await expect(page.locator(".messageArrival")).toBeVisible();
    await page.locator(".messageArrival a").focus();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(async () => {
        const navBox = await page.locator(".siteNavBar").boundingBox();
        const toastBox = await page.locator(".messageArrival").boundingBox();
        return navBox && toastBox ? toastBox.y - navBox.y - navBox.height : -Infinity;
      }).toBeGreaterThanOrEqual(0);
      await expect(page.getByRole("button", { name: "Dismiss message notification", exact: true })).toBeInViewport({ ratio: 1 });
      const compose = await page.getByRole("button", { name: "New message", exact: true }).boundingBox();
      const notice = await page.locator(".messageArrival").boundingBox();
      expect(notice!.y).toBeGreaterThanOrEqual(compose!.y + compose!.height + 12);
      await page.screenshot({ path: testInfo.outputPath(`recipient-arrival-${width}.png`), scale: "css" });
    }
    await page.screenshot({ path: testInfo.outputPath("recipient-arrival.png"), fullPage: true });
    await page.locator(".messageArrival a").click();
    await expect(page).toHaveURL(new RegExp(`/messages/${THREAD}$`));
    await expect(page.locator(".threadMessages").getByText("The Lamb works for me", { exact: true })).toBeVisible();
    unread = 3;
    stamp = "2026-11-16T22:01:00Z";
    await page.evaluate((id) => (window as unknown as { __receiveMessage: (id: string) => void }).__receiveMessage(id), ACCOUNTS.B.id);
    await expect(page.getByRole("link", { name: "Messages, 3 unread", exact: true })).toBeVisible();
    await expect(page.locator(".messageArrival")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("recipient-open-thread.png"), fullPage: true });
  } finally { await senderContext.close(); }
});

test("chat mutes can be changed at every supported width", async ({ page }, testInfo) => {
  await pushRuntime(page);
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  await auth.signedInAs("B");
  await page.route("**/api/messages?**", (route) => route.fulfill({ json: { conversations: [{ id: THREAD, otherHandle: ACCOUNTS.A.handle, lastAt: new Date().toISOString(), lastFromMe: false, unread: 0 }] } }));
  await page.route(`**/api/messages/${THREAD}**`, (route) => route.fulfill({ json: { messages: [] } }));
  let muted = false;
  await page.route("**/api/message-notifications**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "mute") muted = body.muted;
      await route.fulfill({ json: { ok: true, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" } });
    } else await route.fulfill({ json: { enabled: true, preview: false, muted, quiet: muted } });
  });
  await page.goto(`/messages/${THREAD}`);
  await page.getByRole("button", { name: "Chat notifications", exact: true }).click();
  await page.getByRole("button", { name: "Mute this chat", exact: true }).click();
  await expect.poll(() => muted).toBe(true);
  await expect(page.getByRole("button", { name: "Unmute this chat", exact: true })).toBeEnabled();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Unmute this chat", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`muted-${width}.png`), scale: "css" });
  }
  await page.getByRole("button", { name: "Unmute this chat", exact: true }).click();
  await expect.poll(() => muted).toBe(false);
});

for (const stall of ["none", "registration", "tray"] as const) {
test(`account switching and sign-out recover with ${stall} access`, async ({ page }, testInfo) => {
  await pushRuntime(page);
  const auth = await installAuthDoubles(page);
  let owner = "";
  let releases = 0;
  let offlineDetach = false;
  await page.route("**/api/message-notifications**", async (route) => {
    const request = route.request();
    if (request.method() === "DELETE" && offlineDetach) { await route.abort("internetdisconnected"); return; }
    if (request.method() === "DELETE") { owner = ""; releases++; await route.fulfill({ json: { ok: true, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" } }); return; }
    const bearer = request.headers().authorization ?? "";
    const who = bearer.includes("access-token-A") || (bearer.split(".")[1] && JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub === ACCOUNTS.A.id) ? "A" : "B";
    if (request.method() === "POST") { if (["subscribe", "restore"].includes(request.postDataJSON().action)) owner = who; await route.fulfill({ json: { ok: true, bound: true, sessionId: who === "A" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222" } }); }
    else await route.fulfill({ json: { enabled: true, preview: false, muted: false } });
  });
  await page.route("**/api/messages?**", (route) => route.fulfill({ json: { conversations: [] } }));
  await seedSignedIn(page, "A");
  await page.goto("/messages");
  await expect.poll(() => owner).toBe("A");
  await auth.signedInAs("B");
  await page.goto("/messages");
  await expect.poll(() => owner).toBe("B");
  await switchRememberedAccount(page, "B", "A");
  await expect.poll(() => owner).toBe("A");
  await page.screenshot({ path: testInfo.outputPath("returned-to-account-a.png"), scale: "css" });
  offlineDetach = true;
  await page.evaluate(method => { Object.assign(window, { __hangMessageRegistration: method === "registration", __hangMessageTray: method === "tray" }); }, stall);
  await page.getByRole("button", { name: "Sign out of @karan", exact: true }).click();
  await expect(page.getByRole("button", { name: /Account options for Karan M/ })).toBeVisible();
  await page.evaluate(() => { Object.assign(window, { __hangMessageRegistration: false }); });
  expect(await page.evaluate(() => (window as unknown as { __unsubscribedPush: number }).__unsubscribedPush)).toBe(0);
  await expect.poll(() => owner).toBe("B");
  await page.evaluate(() => { Object.assign(window, { __hangMessageTray: false }); });
  await page.screenshot({ path: testInfo.outputPath("offline-sign-out-completed.png") });
  await page.getByRole("button", { name: /Account options for Karan M/ }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true }).or(page.getByRole("link", { name: "Sign in", exact: true })).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pubmax:pending-message-detach") ?? "[]").length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __unsubscribedPush: number }).__unsubscribedPush)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("offline-all-accounts-signed-out.png") });
  await auth.signedInAs(null);
  offlineDetach = false;
  await page.reload();
  await expect.poll(() => owner).toBe("");
  await auth.signedInAs("B");
  await page.goto("/messages");
  await expect.poll(() => owner).toBe("B");
  expect(releases).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => (window as unknown as { __closedNotifications: number }).__closedNotifications)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("account-a-signed-out.png"), scale: "css" });
});
}


test("slow detach still closes private notices on a final sign-out", async ({ page }, testInfo) => {
  await pushRuntime(page, true);
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  let bound = false;
  await page.route("**/api/messages?**", route => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/message-notifications**", async route => {
    if (route.request().method() === "DELETE") return;
    if (route.request().method() === "POST") bound = true;
    await route.fulfill({ json: { enabled: true, preview: true, muted: false, bound: true, sessionId: "11111111-1111-4111-8111-111111111111" } });
  });
  await page.goto("/messages");
  await expect.poll(() => bound).toBe(true);
  const closedBefore = await page.evaluate(() => (window as unknown as { __closedNotifications: number }).__closedNotifications);
  await page.getByRole("button", { name: "Account options for Karan", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true }).or(page.getByRole("link", { name: "Sign in", exact: true })).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __closedNotifications: number }).__closedNotifications)).toBeGreaterThan(closedBefore);
  expect(await page.evaluate(() => (window as unknown as { __unsubscribedPush: number }).__unsubscribedPush)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("slow-detach-notices-closed.png"), scale: "css" });
});

test("iPhone setup explains installation and requires a tap before permission", async ({ page }, testInfo) => {
  await pushRuntime(page);
  await page.addInitScript(() => {
    const mode = sessionStorage.getItem("message-install-mode") ?? "browser";
    if (mode === "browser") {
      delete (window as unknown as { PushManager?: unknown }).PushManager;
      Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    }
    if (mode === "blocked") Object.defineProperty(Notification, "permission", { configurable: true, value: "denied" });
  });
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  await auth.signedInAs("B");
  await page.route("**/api/messages?**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/message-notifications**", (route) => route.fulfill({ json: { enabled: false, preview: false, muted: false, bound: route.request().method() === "POST" && route.request().postDataJSON().action === "subscribe", sessionId: "22222222-2222-4222-8222-222222222222" } }));
  await page.goto("/messages");
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  await expect(page.getByText(/Add to Home Screen/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on message alerts", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("iphone-before-install.png") });
  await page.evaluate(() => sessionStorage.setItem("message-install-mode", "installed"));
  await page.reload();
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  const enable = page.getByRole("button", { name: "Turn on message alerts", exact: true });
  await expect(enable).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(0);
  await enable.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("iphone-installed-permission-tap.png") });
  await page.evaluate(() => sessionStorage.setItem("message-install-mode", "blocked"));
  await page.reload();
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  await expect(page.getByText(/Notifications are blocked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on message alerts", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("iphone-denied-permission.png") });
});


test("an arrival from another chat clears the active header and composer", async ({ page }, testInfo) => {
  const reading = "33333333-3333-4333-8333-333333333333";
  await pushRuntime(page);
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  await auth.signedInAs("B");
  let unread = 1;
  let lastAt = "2026-11-17T09:00:00Z";
  await page.route("**/api/messages?**", route => route.fulfill({ json: { conversations: [
    { id: THREAD, otherHandle: ACCOUNTS.A.handle, lastBody: "A message from the other chat", lastAt, lastFromMe: false, unread },
    { id: reading, otherHandle: "maeve", lastBody: "The chat you are reading", lastAt, lastFromMe: false, unread: 0 },
  ] } }));
  await page.route("**/api/message-notifications**", route => route.fulfill({ json: { enabled: true, preview: false, muted: false, quiet: false, registered: true, bound: true, sessionId: "22222222-2222-4222-8222-222222222222" } }));
  for (const id of [THREAD, reading]) await page.route(`**/api/messages/${id}**`, route => route.fulfill({ json: { messages: [{ id: "message", conversationId: id, senderHandle: id === THREAD ? ACCOUNTS.A.handle : "maeve", body: id === THREAD ? "A message from the other chat" : "The chat you are reading", createdAt: lastAt, read: true, flagged: false }] } }));
  await page.goto(`/messages/${reading}`);
  await expect(page.locator(".threadMessages").getByText("The chat you are reading", { exact: true })).toBeVisible();
  unread = 2;
  lastAt = "2026-11-17T09:01:00Z";
  await page.evaluate(id => (window as unknown as { __receiveMessage: (id: string) => void }).__receiveMessage(id), ACCOUNTS.B.id);
  await expect(page.locator(".messageArrival")).toBeVisible();
  await page.locator(".messageArrival a").focus();
  for (const width of [390, 768, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const header = await page.locator(".threadHeader").boundingBox();
      const notice = await page.locator(".messageArrival").boundingBox();
      return header && notice ? notice.y - header.y - header.height : -Infinity;
    }).toBeGreaterThanOrEqual(12);
    const header = (await page.locator(".threadHeader").boundingBox())!;
    const notice = (await page.locator(".messageArrival").boundingBox())!;
    expect(notice.y - header.y - header.height).toBeLessThanOrEqual(16);
    const pane = (await page.locator(".messagesThreadPane").boundingBox())!;
    expect(Math.abs(notice.x + notice.width / 2 - pane.x - pane.width / 2)).toBeLessThanOrEqual(1);
    const composer = (await page.locator(".composerDock").boundingBox())!;
    expect(notice.y + notice.height).toBeLessThanOrEqual(composer.y - 12);
    await expect(page.getByRole("button", { name: "Dismiss message notification", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`other-chat-${width}.png`), scale: "css" });
  }
  await page.getByRole("link", { name: "Back to inbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
  await expect(page.locator(".messageArrival")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Messages, 2 unread", exact: true })).toBeAttached();
  unread = 3;
  lastAt = "2026-11-17T09:02:00Z";
  await page.evaluate(id => (window as unknown as { __receiveMessage: (id: string) => void }).__receiveMessage(id), ACCOUNTS.B.id);
  await expect(page.locator(".messageArrival")).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator(".messageArrival").boundingBox();
    return box?.y ?? 0;
  }).toBeGreaterThan(500);
  await page.screenshot({ path: testInfo.outputPath("other-chat-return-to-inbox.png"), scale: "css" });
  await expect(page.locator(".messageArrival")).toContainText(`@${ACCOUNTS.A.handle}`);
  await page.locator(".messageArrival a").click();
  await expect(page).toHaveURL(new RegExp(`/messages/${THREAD}$`));
  await expect(page.locator(".threadMessages").getByText("A message from the other chat", { exact: true })).toBeVisible();
});


test("global alert settings recover from a hung browser subscription", async ({ page }, testInfo) => {
  await pushRuntime(page);
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  await auth.signedInAs("B");
  await page.route("**/api/messages?**", route => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/message-notifications**", route => route.fulfill({ json: { enabled: false, preview: false, muted: false, registered: false } }));
  await page.goto("/messages");
  await page.evaluate(() => { (window as unknown as { __hangMessageSubscription: boolean }).__hangMessageSubscription = true; });
  await page.getByRole("button", { name: "Message notifications", exact: true }).click();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("region", { name: "Message alerts", exact: true })).toHaveAttribute("aria-busy", "false");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(retry).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`subscription-timeout-${width}.png`), scale: "css" });
  }
  await page.evaluate(() => { (window as unknown as { __hangMessageSubscription: boolean }).__hangMessageSubscription = false; });
  await retry.click();
  await expect(page.getByRole("checkbox", { name: /Show the sender/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("subscription-timeout-recovered.png"), scale: "css" });
});
