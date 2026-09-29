import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

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
    await stub.signedInAs(null);
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
