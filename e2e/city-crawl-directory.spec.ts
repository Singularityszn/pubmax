import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block" });

test("city crawl Edit stops works while the Place story intro is visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await storeThemeChoice(page, "light");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await installDeterministicMapBasemap(page);
  await page.goto("/crawls");
  await expect(async () => {
    await page.getByRole("link", { name: "Northern Quarter first night", exact: true }).click();
    await expect(page).toHaveURL(/\/map\/manchester\?/, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Dismiss Place story intro", exact: true })).toBeVisible();
  await expectMapLoadingFrameReleased(page);
  const closeLayers = page.getByRole("button", { name: "Close layers", exact: true });
  if (await closeLayers.isVisible()) await closeLayers.click();
  await expect(page.locator(".mapLayersPanel")).toHaveCount(0);

  await page.screenshot({ path: test.info().outputPath("story-and-route-controls.png") });

  // A city directory route must keep its editor accessible without dismissing its story.
  await page.getByRole("button", { name: "Edit stops", exact: true }).click({ timeout: 5000 });
  await expectSoleDesktopDrawer(page, "planner");
  await expect(page.locator(".mapDrawer.left .routeList li > button strong")).toHaveText([
    "Castle Hotel",
    "Gullivers",
    "Port Street Beer House",
    "The Smithfield Market Tavern",
    "The Crown & Kettle",
  ]);
});
