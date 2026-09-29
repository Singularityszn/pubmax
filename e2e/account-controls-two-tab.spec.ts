import { expect, test } from "@playwright/test";

import {
  AUTH_STORAGE_KEY,
  installAuthDoubles,
  resumeCookie,
  seedSignedIn,
} from "./helpers/authDoubles";

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

test("signing out in one tab gates an already open private page in another", async ({ context, page }) => {
  test.setTimeout(120_000);
  const firstTabAuth = await installAuthDoubles(page, {
    initialSeedOnly: true,
    realResumeCookie: true,
  });
  await seedSignedIn(page, "A");
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeTruthy();
  await expect.poll(() => resumeCookie(page)).toBeTruthy();

  const secondTab = await context.newPage();
  const secondTabAuth = await installAuthDoubles(secondTab, {
    initialSeedOnly: true,
    realResumeCookie: true,
  });
  await secondTab.goto("/moment");
  const signInGate = secondTab.getByText("Sign in when you are ready to keep this Moment across devices.");
  await expect(signInGate).toHaveCount(0);
  await expect(secondTab.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/karan");

  firstTabAuth.serverSignedInAs(null);
  secondTabAuth.serverSignedInAs(null);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
  await expect.poll(() => resumeCookie(page)).toBeNull();
  await expect(signInGate).toBeVisible();
  await expect(secondTab.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/you");
  await expect(secondTab.getByRole("link", { name: "Sign in" })).toBeVisible();
});
