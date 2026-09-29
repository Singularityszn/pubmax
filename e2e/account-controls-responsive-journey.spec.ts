import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  installAuthDoubles,
  readDeviceIdentity,
  seedSignedIn,
} from "./helpers/authDoubles";

test.use({ storageState: { cookies: [], origins: [] } });

function siteNav(page: Page) {
  return page.getByRole("navigation", { name: "Site navigation" });
}

async function expectTappable(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  const box = await control.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

async function followNav(page: Page, label: string, destination: RegExp) {
  await expect(async () => {
    await siteNav(page).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(destination, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}px account controls follow Map, Places, Plan, Create and profile`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const stub = await installAuthDoubles(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/map");
    const signIn = siteNav(page).getByRole("button", { name: "Sign in", exact: true });
    await expectTappable(signIn);
    await signIn.click();
    await expect(page.getByRole("link", { name: "Open full sign-in page" })).toBeVisible();
    await page.getByRole("link", { name: "Open full sign-in page" }).click();
    await expect(page).toHaveURL(/\/login\?from=%2Fmap$/);
    await expect(page.getByRole("heading", { name: "Sign in or create your account" })).toBeVisible();

    await page.goto("/map");
    await followNav(page, "Places", /\/places$/);
    await expect(siteNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await followNav(page, "Plan", /\/plan$/);
    await expect(siteNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await followNav(page, "You", /\/u\/you$/);
    await expect(page.getByRole("heading", { name: "Make the night yours." })).toBeVisible();

    await seedSignedIn(page, "A");
    await page.goto("/map");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
    await expectTappable(siteNav(page).getByRole("button", { name: /Account options/ }));
    await followNav(page, "Places", /\/places$/);
    await expect(siteNav(page).getByRole("button", { name: /Account options/ })).toBeVisible();
    await followNav(page, "Plan", /\/plan$/);
    await expect(siteNav(page).getByRole("button", { name: /Account options/ })).toBeVisible();
    await siteNav(page).getByRole("link", { name: "Share a Moment" }).click();
    await expect(page).toHaveURL(/\/moment\?returnTo=%2Fplan$/);
    await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toHaveCount(0);
    await followNav(page, "You", /\/u\/karan$/);
    await expect(siteNav(page).getByRole("button", { name: /Account options/ })).toBeVisible();

    await stub.signedInAs(null);
    await siteNav(page).getByRole("button", { name: /Account options/ }).click();
    const signOut = page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true });
    await expectTappable(signOut);
    await signOut.click();
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBeNull();
    await expect(siteNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.reload();
    await expect(siteNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.goBack();
    await expect(siteNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.goto("/moment?returnTo=%2Fplan");
    await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toBeVisible();
  });
}
