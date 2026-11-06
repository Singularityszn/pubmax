import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased, expectMobileMapShellReady } from "./helpers/mobileMapShell";
import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 390, 430]) {
    test(`map names remain readable at ${width}px and 200 percent text in ${theme}`, async ({ page, context }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      await storeThemeChoice(page, theme);
      await page.addInitScript(() => {
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32 } });
      await installDeterministicMapBasemap(page);
      await page.goto("/map?wild=0");
      await expectMapLoadingFrameReleased(page);
      await expectMobileMapShellReady(page);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute("data-text-scale", "large");
      const city = page.locator(".mobileMapTopbar .citySwitcherLabelFull");
      const pub = page.locator(".mapPeekName");
      await expect(city).toHaveText("London");
      await expect(pub).toHaveText(/\S/);
      await page.screenshot({ path: info.outputPath("large-text-map.png") });
      await info.attach("large-text-map", { path: info.outputPath("large-text-map.png"), contentType: "image/png" });

      // Finding 4 requires complete names at 200 percent browser text.
      // Text rectangles must fit the painted box, rejecting ellipsis or clipping.
      for (const label of [city, pub]) {
        await expect(label).toBeVisible();
        const geometry = await label.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const control = node.closest("button")!.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(node);
          return {
            text: node.textContent,
            left: box.left, right: box.right, top: control.top, bottom: control.bottom,
            rects: [...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
            viewportWidth: innerWidth,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
        for (const rect of geometry.rects) {
          expect(rect.left, `${geometry.text}: left edge`).toBeGreaterThanOrEqual(geometry.left - 1);
          expect(rect.right, `${geometry.text}: right edge`).toBeLessThanOrEqual(geometry.right + 1);
          expect(rect.top, `${geometry.text}: top edge`).toBeGreaterThanOrEqual(geometry.top - 1);
          expect(rect.bottom, `${geometry.text}: bottom edge`).toBeLessThanOrEqual(geometry.bottom + 1);
        }
      }
    });
  }
}
