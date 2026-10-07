import { expect, test } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectStreamedPageSettled } from "./helpers/streamedPage";

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`profile account menu owns its taps at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installAuthDoubles(page);
    await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: {
            id: ACCOUNTS.A.id,
            handle: ACCOUNTS.A.handle,
            displayName: ACCOUNTS.A.name,
            bio: "A local looking for a good pint.",
            createdAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
          socialLinks: [],
          counts: { followers: 0, following: 0 },
          viewerFollowing: false,
          followsViewer: false,
        }),
      }),
    );
    await seedSignedIn(page, "A");
    await page.goto(`/u/${ACCOUNTS.A.handle}`);
    await expectStreamedPageSettled(page);
    await expect(page.locator(".profileIdentity")).toBeVisible();

    const menu = page.locator(".authAccountMenu");
    await expect(async () => {
      if (!(await menu.isVisible())) {
        await page.getByRole("button", { name: /Account options/ }).click();
      }
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    const controls = menu.locator("a, button");
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      await expect.poll(() => control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== null && element.contains(hit);
      })).toBe(true);
    }

    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: /Account options/ })).toHaveCount(0);
    const signIn = page.getByRole("link", { name: "Sign in", exact: true })
      .or(page.getByRole("button", { name: "Sign in", exact: true }));
    await expect(signIn.first()).toBeVisible();
  });
}
