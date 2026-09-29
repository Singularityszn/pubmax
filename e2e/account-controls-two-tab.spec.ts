import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  AUTH_STORAGE_KEY,
  installAuthDoubles,
  readDeviceAccounts,
  readDeviceIdentity,
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

test("switching from A to B in one tab updates the other tab's account", async ({ context, page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const firstTabAuth = await installAuthDoubles(page, { initialSeedOnly: true });
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);

  // Seed B as a previously signed-in device account, then return the active
  // session to A. The measured A-to-B transition below goes through the real
  // account switch control and Supabase SDK storage event.
  await firstTabAuth.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await firstTabAuth.signedInAs("A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(2);

  const secondTab = await context.newPage();
  await installAuthDoubles(secondTab, { initialSeedOnly: true });
  await secondTab.setViewportSize({ width: 1440, height: 900 });
  await secondTab.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(secondTab)).handle).toBe(ACCOUNTS.A.handle);

  await page.getByRole("button", { name: /Account options/ }).first().click();
  await page.locator(".authAccountMenu").getByRole("button", { name: "Switch account" }).click();
  const accountB = page.locator(".authAccountMenu .authSwitcherRow").filter({ hasText: ACCOUNTS.B.handle });
  await expect(accountB).toBeVisible();
  await accountB.click();

  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect.poll(async () => (await readDeviceIdentity(secondTab)).handle).toBe(ACCOUNTS.B.handle);
  await expect(secondTab.getByRole("button", { name: /Account options/ }).first()).toBeVisible();
});
