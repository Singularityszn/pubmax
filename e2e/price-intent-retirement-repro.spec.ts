import { test, expect } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
test("consumed price intent retires and Create can start another contribution", async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 844 });
 await page.addInitScript(() => {
  localStorage.setItem("pubmax-tour-v1-done", "1");
  localStorage.setItem("pubmax_onboarding_dismissed", "1");
  sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
 });
 await installAuthDoubles(page);
 await seedSignedIn(page, "A");
 await installDeterministicMapBasemap(page);
 await page.goto("/map/manchester?drink=wine&contribute=price");
 await expect(page.locator(".logIntentNearbyBtn").first()).toBeVisible({ timeout: 45000 });
 await page.locator(".logIntentNearbyBtn").first().click();
 await expect(page.getByRole("textbox", { name: /Price of a wine at/ })).toBeVisible();
 await expect.poll(() => new URL(page.url()).searchParams.get("contribute")).toBeNull();
 await page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .surfaceNavHome').click();
 await expect(page.getByRole("textbox", { name: /Price of a wine at/ })).toBeHidden();
 await expect.poll(() => new URL(page.url()).searchParams.get("contribute")).toBeNull();
 await expect(async () => {
  await page.getByTestId("create-fab").click();
  await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" })).toBeVisible({timeout:1000});
 }).toPass({ timeout:20000 });
 await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
 await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout:45000 });
 await page.locator(".logIntentNearbyBtn").first().click();
 await expect(page.getByRole("textbox", { name: /Price of a wine at/ })).toBeVisible();
 await expect.poll(() => new URL(page.url()).searchParams.get("contribute")).toBeNull();
});
