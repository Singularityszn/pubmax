import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";

import {
  clickLuciaAndReturn, clickRankingAndCheckRecordedCosts, enterMountedSoftDrinks,
} from "./helpers/spoonsMountedJourney";

// Opt-in through the owned packet config. Public WebKit touch input supports taps,
// not trusted swipe dispatch. This case proves navigation/layout only, never scroll recovery.
test.use({ isMobile: true, hasTouch: true, serviceWorkers: "block" });

for (const width of [320, 390]) {
  test(`${width}px WebKit touch taps open Lucia and Spoons and return through the mounted map`, async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const path = testInfo.outputPath("input-provenance.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      engine: "cached Playwright WebKit", version: browser.version(),
      executable: browser.browserType().executablePath(), input: "public Locator.tap",
      swipeRecovery: "UNVERIFIED", physicalIPhone: "UNVERIFIED",
    }, null, 2) + "\n");
    try {
      const documentStartedAt = await enterMountedSoftDrinks(page);
      await clickLuciaAndReturn(page, documentStartedAt, testInfo);
      await clickRankingAndCheckRecordedCosts(page, documentStartedAt, testInfo);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`webkit-spoons-navigation-${width}.png`) });
    } finally {
      await testInfo.attach("input-provenance", { path, contentType: "application/json" });
    }
  });
}
