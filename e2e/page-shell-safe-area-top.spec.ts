import { expect, test } from "@playwright/test";

import { expectStreamedPageSettled } from "./helpers/streamedPage";

for (const width of [320, 390, 768, 1440]) {
  for (const path of ["/today", "/tonight", "/plan", "/pal", "/pal/chat"]) {
    test(`${path} pays the top safe area once at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      await page.goto(path);
      await expectStreamedPageSettled(page);
      const nav = page.locator("nav.siteNavBar:visible");
      const heading = page.getByRole("heading", { level: 1 }).first();
      await expect(nav).toHaveCount(1);
      await expect(heading).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const beforeNav = (await nav.boundingBox())!;
      const beforeHeading = (await heading.boundingBox())!;
      expect(beforeNav.y).toBeCloseTo(width <= 640 ? 10 : 12, 0);

      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 47, right: 0, bottom: 0, left: 0 },
      });
      await expect.poll(async () => (await nav.boundingBox())!.y).toBeCloseTo(beforeNav.y + 47, 0);
      const afterNav = (await nav.boundingBox())!;
      const afterHeading = (await heading.boundingBox())!;
      expect(afterHeading.y - afterNav.y - afterNav.height).toBeCloseTo(
        beforeHeading.y - beforeNav.y - beforeNav.height, 0,
      );
      expect(afterHeading.y).toBeGreaterThanOrEqual(afterNav.y + afterNav.height);
      expect(afterHeading.width).toBeGreaterThan(0);
      await cdp.detach();
    });
  }
}
