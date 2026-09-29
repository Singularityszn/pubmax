import { expect, test, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  installAuthDoubles,
  readDeviceIdentity,
  seedSignedIn,
} from "./helpers/authDoubles";

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test("Map and Create follow phone sign-out through refresh and Back", async ({ page }) => {
  test.setTimeout(120_000);
  const stub = await installAuthDoubles(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  await page.goto("/map");
  await expect(primaryNav(page).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/you");
  await primaryNav(page).getByRole("link", { name: "You" }).click();
  await expect(page).toHaveURL(/\/u\/you$/);
  await expect(page.getByRole("heading", { name: "Make the night yours." })).toBeVisible();
  await page.getByRole("link", { name: "Claim your @handle" }).click();
  await expect(page).toHaveURL(/\/login\?mode=signin&from=%2Fu%2Fyou$/);
  await expect(page.getByRole("heading", { name: "Sign in or create your account" })).toBeVisible();
  await page.goto("/map");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("link", { name: "Post a moment", exact: true }).click();
  await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
  await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toBeVisible();

  await seedSignedIn(page, "A");
  await page.goto("/map");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(primaryNav(page).getByRole("link", { name: "You" })).toHaveAttribute("href", `/u/${ACCOUNTS.A.handle}`);
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("link", { name: "Post a moment", exact: true }).click();
  await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
  await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toHaveCount(0);

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await stub.signedInAs(null);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBeNull();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in or create your account" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
  await expect(primaryNav(page).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/you");
  await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toBeVisible();
});
