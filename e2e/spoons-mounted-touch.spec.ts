import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type CDPSession } from "@playwright/test";

import {
  clickLuciaAndReturn, clickRankingAndCheckRecordedCosts, drinkSheet,
  enterMountedSoftDrinks, lowerContentGeometry,
} from "./helpers/spoonsMountedJourney";

test.use({ isMobile: true, hasTouch: true, serviceWorkers: "block" });

for (const width of [320, 390]) {
  test(`${width}px mounted Drink touch swipe reaches the lower explanation and both price destinations`, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    // Both short phone widths must exercise real overflow. The normal390x844
    // control remains a separate case, not a fabricated paragraph or forced scroll position.
    await page.setViewportSize({ width, height: 568 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const documentStartedAt = await enterMountedSoftDrinks(page);
    const before = await lowerContentGeometry(page);
    const body = drinkSheet(page).locator(".mobileSharedSheetBody");
    let cdp: CDPSession | undefined;
    try {
      expect(before.overflow).toBeGreaterThan(0);
      expect(before.lowerFullyReachable).toBe(false);
      cdp = await context.newCDPSession(page);
      for (let swipe = 0; swipe < 4 && !(await lowerContentGeometry(page)).lowerFullyReachable; swipe += 1) {
        const box = (await body.boundingBox())!;
        const x = box.x + box.width / 2;
        const startY = box.y + box.height - 20;
        const endY = box.y + 20;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
        for (let step = 1; step <= 12; step += 1) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove", touchPoints: [{ x, y: startY + (endY - startY) * step / 12 }],
          });
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await expect.poll(async () => (await lowerContentGeometry(page)).lowerFullyReachable).toBe(true);
      const after = await lowerContentGeometry(page);
      expect(after.scrollTop).toBeGreaterThan(before.scrollTop);
      expect(after.documentScrollY).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`mounted-drink-lower-${width}.png`) });
    } finally {
      try {
        const after = await lowerContentGeometry(page).catch(error => ({ captureError: String(error) }));
        const path = testInfo.outputPath("actual-touch-scroll.json");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({
          engine: "Chromium CDP touch emulation", viewport: { width, height: 568 }, before, after,
        }, null, 2) + "\n");
        await testInfo.attach("actual-touch-scroll", { path, contentType: "application/json" });
      } finally {
        await cdp?.detach();
      }
    }
    await clickLuciaAndReturn(page, documentStartedAt, testInfo);
    await clickRankingAndCheckRecordedCosts(page, documentStartedAt, testInfo);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`mounted-spoons-return-${width}.png`) });
  });
}
