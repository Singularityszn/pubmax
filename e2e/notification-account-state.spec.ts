import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test.use({
  viewport: { width: 1440, height: 900 },
  storageState: { cookies: [], origins: [] },
});

test("sign-out removes the previous account's Activity count", async ({ page }) => {
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
  await expect(async () => {
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await expect(page.locator(".authAccountMenu")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();

  await expect(page.getByRole("link", { name: "Activity", exact: true }).first()).toBeVisible();
  await expect(page.locator(".siteNavBellBadge").first()).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("notification-signed-out.png") });
});
