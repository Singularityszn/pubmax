import { expect, test } from "@playwright/test";

test.describe("venue reveal reduced motion", () => {
  test("skips entrance classes under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map");
    await page.waitForSelector(".mapCanvas", { timeout: 60_000 });

    const cluster = page.locator(".maplibregl-canvas").first();
    const box = await cluster.boundingBox();
    if (!box) throw new Error("map canvas missing");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForTimeout(600);

    const revealClasses = await page.evaluate(() => {
      const inspector = document.querySelector(".venueInspector");
      if (!inspector) return { missing: true };
      const className = inspector.className;
      return {
        missing: false,
        hasReveal: className.includes("venueReveal"),
        bloomAnimation: getComputedStyle(
          document.querySelector(".venueRevealBloom") ?? document.body,
        ).animationName,
      };
    });

    if (!revealClasses.missing) {
      expect(revealClasses.hasReveal).toBe(false);
    }
    expect(revealClasses.bloomAnimation).not.toMatch(/venueRevealBloom/);
  });
});
