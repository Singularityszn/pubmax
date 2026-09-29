import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  AUTH_STORAGE_KEY,
  accessJwt,
  installAuthDoubles,
} from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

test.setTimeout(90_000);

test("Manchester wine price intent survives a locally owned auth callback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installAuthDoubles(page);
  await installDeterministicMapBasemap(page);
  await page.goto("/map/manchester?drink=wine");

  await expect(async () => {
    await page.getByTestId("create-fab").click();
    await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }))
      .toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
  await expect(page.getByText("Pick a pub to log a price")).toBeVisible({ timeout: 45_000 });
  const chosenPub = page.locator(".logIntentNearbyBtn").first();
  await expect(chosenPub).toBeVisible();
  const venueName = (await chosenPub.locator("span").first().textContent())?.trim();
  expect(venueName).toBeTruthy();
  await chosenPub.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet.getByRole("heading", { name: "Sign in to add a price" })).toBeVisible();
  await expect(sheet).toContainText(venueName!);
  const returnUrl = new URL(page.url());
  expect(returnUrl.pathname).toBe("/map/manchester");
  expect(returnUrl.searchParams.get("drink")).toBe("wine");
  expect(returnUrl.searchParams.get("sel")).toBeTruthy();
  expect(returnUrl.searchParams.get("contribute")).toBe("price");
  const venueId = returnUrl.searchParams.get("sel");
  const attemptId = "a".repeat(32);
  await page.evaluate((id) => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem("pubmax_auth_active_attempt", JSON.stringify({
      id, expiresAt, callbackClaimed: false,
    }));
    window.sessionStorage.setItem("pubmax_auth_tab_attempt", JSON.stringify({ id, expiresAt }));
  }, attemptId);
  returnUrl.searchParams.set("_authCallback", "1");
  returnUrl.searchParams.set("_authAttempt", attemptId);
  returnUrl.hash = new URLSearchParams({
    access_token: accessJwt(ACCOUNTS.A),
    refresh_token: ACCOUNTS.A.refreshToken,
    token_type: "bearer",
  }).toString();
  await page.goto(returnUrl.toString());

  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { user: { id: string } }).user.id : null;
  }, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.A.id);
  expect(await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { refresh_token: string }).refresh_token : null;
  }, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.A.refreshToken);
  await expect(page.getByRole("alert").filter({ hasText: "Sign in as" })).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain("access_token");
  expect(page.url()).not.toContain("refresh_token");
  expect(page.url()).not.toContain("_authCallback");
  const finalUrl = new URL(page.url());
  expect(finalUrl.hash).toBe("");
  expect(finalUrl.searchParams.has("_authAttempt")).toBe(false);
  expect(finalUrl.pathname).toBe("/map/manchester");
  expect(finalUrl.searchParams.get("drink")).toBe("wine");
  expect(finalUrl.searchParams.get("sel")).toBe(venueId);
  await expect(sheet.getByRole("textbox", { name: new RegExp(`Price of a wine at ${venueName}`) }))
    .toBeVisible({ timeout: 30_000 });
});
