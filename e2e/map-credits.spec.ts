import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

for (const theme of ["light", "dark"] as const) {
  for (const provider of ["openfreemap", "carto"] as const) {
    test(`${theme} phone credits follow the loaded ${provider} style`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      });
      await installDeterministicMapBasemap(page);
      if (provider === "carto") {
        await page.route(/^https:\/\/tiles\.openfreemap\.org\/styles\//, (route) =>
          route.abort("failed"),
        );
      }
      await page.goto("/map");
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 30_000 });
      const credits = page.locator(".mobileMapCredits");
      await expect(async () => {
        await page.locator(".mobileMapTopbar").getByRole("button", {
          name: "More map controls",
        }).click();
        await expect(credits).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await credits.scrollIntoViewIfNeeded();
      await expect(credits).toContainText("Pub data © OpenStreetMap contributors (ODbL)");
      await expect(credits).toContainText(provider === "carto" ? "CARTO" : "OpenFreeMap");
      await expect(credits).not.toContainText(provider === "carto" ? "OpenFreeMap" : "CARTO");
      if (provider === "carto") await expect(credits).not.toContainText("OpenMapTiles");
    });
  }
}
