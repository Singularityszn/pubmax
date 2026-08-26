import { expect, test } from "@playwright/test";

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  ["arnos arms", "338 bowes road, arnos grove, london, n11 1an", "51.61620", "-0.13212"].join("|")
);

test.describe("venue reveal reduced motion", () => {
  test("skips entrance classes under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
    const inspector = page.locator(".venueInspector");
    await expect(inspector).toBeVisible({ timeout: 60_000 });

    await page.waitForTimeout(600);

    const revealClasses = await page.evaluate(() => {
      const inspector = document.querySelector(".venueInspector");
      if (!inspector) throw new Error("venue inspector missing");
      return {
        className: inspector.className,
        dataReveal: inspector.getAttribute("data-reveal"),
        bloomAnimation: getComputedStyle(
          document.querySelector(".venueRevealBloom") ?? document.body,
        ).animationName,
      };
    });

    expect(revealClasses.className).not.toMatch(/venueReveal/);
    expect(revealClasses.dataReveal).toBeNull();
    expect(revealClasses.bloomAnimation).not.toMatch(/venueRevealBloom/);
  });

  test("keeps the price figure outside reveal animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);

    const inspector = page.locator(".venueInspector");
    await expect(inspector).toBeVisible({ timeout: 60_000 });
    const figure = inspector.locator(".priceBadge").first();
    await expect(figure).toBeVisible();
    await expect.poll(() => figure.evaluate((node) => getComputedStyle(node).animationName)).not.toMatch(
      /venueReveal/,
    );
  });
});
