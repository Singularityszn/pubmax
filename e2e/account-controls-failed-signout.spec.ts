import { expect, test } from "@playwright/test";

import {
  AUTH_STORAGE_KEY,
  installAuthDoubles,
  resumeCookie,
  seedSignedIn,
} from "./helpers/authDoubles";

test.use({ storageState: { cookies: [], origins: [] } });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  for (const status of [401, 503]) {
    test(`logout ${status} still clears this browser's session at ${viewport.width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await installAuthDoubles(page, { initialSeedOnly: true, realResumeCookie: true });
      await seedSignedIn(page, "A");
      await page.goto("/moment");
      const signInGate = page.getByText(
        "Sign in when you are ready to keep this Moment across devices.",
      );
      await expect(signInGate).toHaveCount(0);
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeTruthy();
      await expect.poll(() => resumeCookie(page)).toBeTruthy();

      let revocationRequests = 0;
      await page.route("**/auth/v1/logout?scope=*", async (route) => {
        revocationRequests += 1;
        await route.fulfill({
          status,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ message: "Revocation unavailable" }),
        });
      });

      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect.poll(() => revocationRequests).toBe(1);
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
      await expect.poll(() => resumeCookie(page)).toBeNull();
      await page.goBack();
      await expect(page).toHaveURL(/\/moment$/);
      await expect(signInGate).toBeVisible();
      await page.reload();
      await expect(signInGate).toBeVisible();
      if (viewport.width <= 640) {
        await expect(
          page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" }),
        ).toHaveAttribute("href", "/u/you");
      } else {
        await expect(
          page.getByRole("navigation", { name: "Site navigation" }).getByRole("button", { name: "Sign in", exact: true }),
        ).toBeVisible();
      }
    });
  }
}
