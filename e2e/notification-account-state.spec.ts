import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  installAuthDoubles,
  readDeviceIdentity,
  seedSignedIn,
} from "./helpers/authDoubles";

test.use({
  storageState: { cookies: [], origins: [] },
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`sign-out removes the previous account's Activity count at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const stub = await installAuthDoubles(page);
    await page.route("**/api/notifications?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ unread: 7 }),
      }),
    );
    await seedSignedIn(page, "A");
    await page.goto("/today");

    const activity = page.getByRole("link", { name: "Activity: 7 unread" }).first();
    await expect(activity).toBeVisible();
    stub.serverSignedInAs(null);
    await page.getByRole("button", { name: /Account options/ }).first().click();
    const signOut = page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true });
    await expect(signOut).toBeInViewport();
    await expect.poll(() => signOut.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit === button || button.contains(hit);
    })).toBe(true);
    await page.locator(".authAccountMenu").evaluate(async (menu) => {
      await Promise.all(menu.getAnimations().map((animation) => animation.finished));
    });
    if (viewport.width === 390) {
      await page.screenshot({ path: "/tmp/pubmax-notification-phone-before.png" });
    }
    await signOut.click({ timeout: 3_000 });

    await expect(page.getByRole("link", { name: "Activity", exact: true }).first()).toBeVisible();
    await expect(page.locator(".siteNavBellBadge").first()).toHaveCount(0);
    await expect(page.getByRole(viewport.width === 390 ? "link" : "button", { name: "Sign in", exact: true }).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (viewport.width === 390) {
      await page.screenshot({ path: "/tmp/pubmax-notification-phone-after.png" });
    }
  });
}

test("a late A notification cannot replace B's badge after an account switch", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/notifications?handle=karan")) {
        // Leave this one request in flight after its component aborts it, so
        // the browser can deliver a response that was already on its way back.
        return nativeFetch(input, { ...init, signal: new AbortController().signal });
      }
      return nativeFetch(input, init);
    };
  });

  const stub = await installAuthDoubles(page, { initialSeedOnly: true });
  let holdNextA = false;
  let lateAResponseDelivered = false;
  let markARequestHeld: (() => void) | null = null;
  const aRequestHeld = new Promise<void>((resolve) => { markARequestHeld = resolve; });
  let releaseA: (() => Promise<void>) | null = null;
  await page.route("**/api/notifications?**", async (route) => {
    const handle = new URL(route.request().url()).searchParams.get("handle");
    if (handle === ACCOUNTS.A.handle && holdNextA) {
      holdNextA = false;
      markARequestHeld?.();
      await new Promise<void>((resolve) => {
        releaseA = async () => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ unread: 9 }),
          });
          lateAResponseDelivered = true;
          resolve();
        };
      });
      return;
    }
    const unread = handle === ACCOUNTS.B.handle ? 3 : 7;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ unread }),
    });
  });

  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await stub.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await stub.signedInAs("A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);

  const activity = page.getByRole("link", { name: "Activity: 7 unread" }).first();
  await expect(activity).toBeVisible();
  holdNextA = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await aRequestHeld;

  await page.getByRole("button", { name: /Account options/ }).first().click();
  await page.locator(".authAccountMenu").getByRole("button", { name: "Switch account" }).click();
  const accountB = page.locator(".authAccountMenu .authSwitcherRow").filter({ hasText: ACCOUNTS.B.handle });
  await expect(accountB).toBeVisible();
  await accountB.click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.getByRole("link", { name: "Activity: 3 unread" }).first()).toBeVisible();
  await expect(page.locator(".siteNavBellBadge").first()).toHaveText("3");

  await releaseA?.();
  expect(lateAResponseDelivered).toBe(true);
  await expect(page.getByRole("link", { name: "Activity: 3 unread" }).first()).toBeVisible();
  await expect(page.locator(".siteNavBellBadge").first()).toHaveText("3");
});
