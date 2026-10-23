import { expect, test, type Page, type Route } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

const EVIDENCE = process.env.NM_EVIDENCE_DIR;
test.use({ serviceWorkers: "block" });

async function record(name: string, value: unknown) {
  if (EVIDENCE) await writeFile(`${EVIDENCE}/${name}.json`, JSON.stringify(value, null, 2));
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: false });
}

async function visibility(page: Page, value: "visible" | "hidden") {
  // The isolated browser always reports visible, including background pages.
  // Change only its environment input; the shipped listeners and fetches run.
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

async function focus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

const conversation = (unread: number) => ({ id: "c1", otherHandle: "karansznx", lastBody: "Meet at seven", lastAt: "2026-10-23T12:00:00Z", lastFromMe: false, unread });
type Pending = { route: Route; path: string };

async function badges(page: Page, start = "/today", initiallyHidden = false) {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  await page.addInitScript(() => {
    localStorage.setItem("pubmax_handle", "karan");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    const original = window.fetch.bind(window);
    (window as any).__badgeAborts = [];
    window.fetch = (input, init) => {
      const path = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (/\/api\/(messages|notifications)\?/.test(path)) {
        init?.signal?.addEventListener("abort", () => (window as any).__badgeAborts.push(path));
        // Model a response that still arrives after cancellation.
        return original(input, { ...init, signal: undefined });
      }
      return original(input, init);
    };
  });
  const requests: string[] = [];
  const pending: Pending[] = [];
  let hold = false;
  let count = 3;
  async function answer(route: Route, path: string, unread = count) {
    await route.fulfill({ json: path.startsWith("/api/messages") ? { conversations: [conversation(unread)] } : { notifications: [], unread } });
  }
  for (const pattern of ["**/api/messages?**", "**/api/notifications?**"]) {
    await page.route(pattern, async (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (hold) pending.push({ route, path });
      else await answer(route, path);
    });
  }
  if (initiallyHidden) {
    await page.addInitScript(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  }
  await page.goto(start);
  const messages = page.locator('a.siteNavBell[href="/messages"]');
  const activity = page.locator('a.siteNavBell[href="/activity"]');
  await expect(messages).toHaveAttribute("aria-label", initiallyHidden ? "Messages" : "Messages, 3 unread");
  await expect(activity).toHaveAttribute("aria-label", initiallyHidden ? "Activity" : "Activity: 3 unread");
  return { auth, messages, activity, requests, pending, setHold: (value: boolean) => { hold = value; }, setCount: (value: number) => { count = value; }, answer };
}

for (const width of [390, 1280]) {
  test(`consent withdrawal stops SDK route activity and rejects later measurements at ${width}px`, async ({ page }) => {
    test.skip(process.env.VERCEL !== "1", "Build and run with VERCEL=1 to exercise the SDK lifecycle.");
    await page.setViewportSize({ width, height: 844 });
    const auth = await installAuthDoubles(page, { analyticsConsent: "pending" });
    await seedSignedIn(page, "A");
    await auth.signedInAs("A");
    await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { unread: 0, notifications: [] } }));
    await page.route("**/api/messages?**", (route) => route.fulfill({ json: { conversations: [] } }));
    const scripts: string[] = [];
    await page.route("**/_vercel/**", async (route) => {
      scripts.push(new URL(route.request().url()).pathname);
      await route.fulfill({ contentType: "application/javascript", body: "/* isolated telemetry sink */" });
    });
    await page.addInitScript(() => localStorage.removeItem("pubmaxx:analytics-consent:v1"));
    await page.goto("/u/you");
    const settings = page.locator("#analytics-settings");
    await expect(settings).toBeVisible();
    expect(scripts).toEqual([]);
    await settings.getByRole("button", { name: "Allow", exact: true }).click();
    await expect.poll(() => scripts.length).toBe(2);
    const measurement = () => page.evaluate(() => {
      const w = window as any;
      const analytics = w.vaq.filter((entry: any[]) => entry[0] === "beforeSend").at(-1)[1];
      const speed = w.siq.filter((entry: any[]) => entry[0] === "beforeSend").at(-1)[1];
      return { analytics: analytics({ type: "pageview", url: location.href }), speed: speed({ type: "vital", url: location.href }) };
    });
    const allowed = await measurement();
    expect(allowed.analytics).not.toBeNull();
    expect(allowed.speed).not.toBeNull();
    await shot(page, `consent-allowed-${width}`);
    await settings.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
    expect(await measurement()).toEqual({ analytics: null, speed: null });
    const sdkState = () => page.evaluate(() => ({
      pageviews: (window as any).vaq.filter((entry: any[]) => entry[0] === "pageview").length,
      speedRoute: document.querySelector<HTMLScriptElement>('script[src*="speed-insights/script"]')?.dataset.route,
    }));
    const before = await sdkState();
    expect(before.pageviews).toBeGreaterThan(0);
    expect(before.speedRoute).toBe("/u/[handle]");
    await shot(page, `consent-withdrawn-${width}`);
    await page.locator('a[href="/privacy"]').first().click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.waitForTimeout(500);
    expect(await sdkState()).toEqual(before);
    expect(scripts).toHaveLength(2);
    await record(`consent-lifecycle-${width}`, { scripts, allowed, denied: await measurement(), before, after: await sdkState() });
  });
}

test("badges combine pending reads, pause hidden pages, and reject late cancelled responses", async ({ page }) => {
  await page.clock.install();
  const state = await badges(page);
  await page.evaluate(() => { (window as any).__badgeAborts = []; });
  state.setHold(true);
  const initial = state.requests.length;
  await focus(page);
  await expect.poll(() => state.pending.length).toBe(2);
  await focus(page);
  await focus(page);
  await page.clock.runFor(60_000);
  expect(state.requests.length).toBe(initial + 2);
  await visibility(page, "hidden");
  await page.clock.runFor(180_000);
  await focus(page);
  expect(state.requests.length).toBe(initial + 2);
  const aborted = await page.evaluate(() => (window as any).__badgeAborts);
  expect(aborted).toHaveLength(2);
  await visibility(page, "visible");
  await focus(page);
  await expect.poll(() => state.pending.length).toBe(4);
  expect(state.requests.length).toBe(initial + 4);
  for (const item of state.pending.slice(2)) await state.answer(item.route, item.path, 7);
  await expect(state.messages).toHaveAttribute("aria-label", "Messages, 7 unread");
  await expect(state.activity).toHaveAttribute("aria-label", "Activity: 7 unread");
  for (const item of state.pending.slice(0, 2)) await state.answer(item.route, item.path, 99);
  await page.waitForTimeout(100);
  await expect(state.messages).toHaveAttribute("aria-label", "Messages, 7 unread");
  await expect(state.activity).toHaveAttribute("aria-label", "Activity: 7 unread");
  await shot(page, "badges-latest-response");
  await record("badge-races", { initial, requests: state.requests, aborted, labels: [await state.messages.getAttribute("aria-label"), await state.activity.getAttribute("aria-label")], visibilityInput: "injected browser visibility transitions", clock: "accelerated browser timers" });
});

test("signing out cancels pending badge reads and prevents signed-out polling", async ({ page }) => {
  await page.clock.install();
  const state = await badges(page);
  state.setHold(true);
  await focus(page);
  await expect.poll(() => state.pending.length).toBe(2);
  await state.auth.signedInAs(null);
  await page.getByRole("button", { name: /Account options/ }).first().click();
  await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(state.messages).toHaveCount(0);
  await expect(state.activity).toHaveCount(0);
  for (const item of state.pending) await state.answer(item.route, item.path, 99);
  const count = state.requests.length;
  await focus(page);
  await page.clock.runFor(180_000);
  expect(state.requests.length).toBe(count);
  await expect(state.messages).toHaveCount(0);
  await expect(state.activity).toHaveCount(0);
  await shot(page, "badges-signed-out");
  await record("badge-signout", { requests: state.requests, aborts: await page.evaluate(() => (window as any).__badgeAborts), finalBadgeCount: await page.locator("a.siteNavBell").count() });
});

test("opening an unread thread refreshes the message badge immediately despite a pending count", async ({ page }) => {
  await page.clock.install();
  const state = await badges(page, "/messages");
  state.setHold(true);
  await focus(page);
  await expect.poll(() => state.pending.filter((item) => item.path === "/api/messages").length).toBeGreaterThan(0);
  state.setHold(false);
  state.setCount(0);
  await page.route("**/api/messages/c1?**", (route) => route.fulfill({ json: {
    messages: [{ id: "m1", conversationId: "c1", senderHandle: "karansznx", body: "Meet at seven", createdAt: "2026-10-23T12:00:00Z", read: false, flagged: false }],
    conversation: { kind: "direct", members: ["karan", "karansznx"], title: null },
  } }));
  await page.locator('a[href="/messages/c1"]').first().click();
  await expect(page.getByText("Meet at seven", { exact: true }).last()).toBeVisible();
  await expect(state.messages).toHaveAttribute("aria-label", "Messages");
  for (const item of state.pending) await state.answer(item.route, item.path, 99);
  await expect(state.messages).toHaveAttribute("aria-label", "Messages");
  await shot(page, "message-read-immediate");
  await record("message-read", { requests: state.requests, label: await state.messages.getAttribute("aria-label"), clockAdvanced: false });
});

test("an initially hidden tab waits for visibility and then polls once per minute", async ({ page }) => {
  await page.clock.install();
  const state = await badges(page, "/today", true);
  await focus(page);
  await page.clock.runFor(180_000);
  expect(state.requests).toEqual([]);
  await visibility(page, "visible");
  await expect(state.messages).toHaveAttribute("aria-label", "Messages, 3 unread");
  await expect(state.activity).toHaveAttribute("aria-label", "Activity: 3 unread");
  expect(state.requests).toHaveLength(2);
  await page.clock.runFor(60_000);
  await expect.poll(() => state.requests.length).toBe(4);
  await record("badge-initial-hidden", { requestsBeforeVisibility: 0, requestsAfterVisibility: 2, requestsAfterMinute: state.requests.length });
});
