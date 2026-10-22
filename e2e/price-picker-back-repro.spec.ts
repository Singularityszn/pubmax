import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

test.use({ serviceWorkers: "block" });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await installAuthDoubles(page);
  await installDeterministicMapBasemap(page);
});

const venueSheet = (page: Page) => page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
const contributeParam = (page: Page) => new URL(page.url()).searchParams.get("contribute");

async function openCreateLogAPrice(page: Page) {
  await expect(async () => {
    await page.getByTestId("create-fab").click();
    await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
  await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout: 45_000 });
}

test("Back restores held anonymous price picker", async ({ page }) => {
  await page.goto("/map/manchester?drink=wine");
  await openCreateLogAPrice(page);
  const firstName = (await page.locator(".logIntentNearbyBtn").first().locator("span").first().textContent())?.trim();
  expect(firstName).toBeTruthy();
  await page.locator(".logIntentNearbyBtn").first().click();
  await expect(venueSheet(page).getByRole("heading", { name: "Sign in to add a price" })).toBeVisible();
  const firstVenueId = new URL(page.url()).searchParams.get("sel");
  await venueSheet(page).locator(".surfaceNavBack").click();
  await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => contributeParam(page)).toBe("price");
  await page.locator(".logIntentNearbyBtn").filter({ hasNotText: firstName! }).first().click();
  await expect(venueSheet(page).getByRole("heading", { name: "Sign in to add a price" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("sel")).not.toBe(firstVenueId);
  expect(contributeParam(page)).toBe("price");
});
