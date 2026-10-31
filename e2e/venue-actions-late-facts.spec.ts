import { expect, test } from "@playwright/test";

const VENUE_ID = "venue-eltcmh";
const VENUE_NAME = "The Blackfriar";
const LIST = "Want to Visit";
const STORAGE_KEY = "pubmax:savedPubs:v1";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

for (const width of [1440, 390]) {
  test(`a late area comparison keeps Create & save under the pointer at ${width}px`, async ({ page }, testInfo) => {
    test.slow();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(({ key }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
      window.localStorage.setItem(key, "[]");
    }, { key: STORAGE_KEY });

    let releaseComparison!: () => void;
    const comparisonGate = new Promise<void>((resolve) => { releaseComparison = resolve; });
    await page.route("**/data/pint_index_snapshot.json", async (route) => {
      await comparisonGate;
      await route.continue();
    });
    let pointerHeld = false;
    try {
      const response = await page.goto(`/map?sel=${VENUE_ID}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      const surface = width === 390
        ? page.locator('.mobileSheetPortal[data-sheet-kind="venue"]')
        : page.locator(".mapDrawer.right.springDrawer");
      await expect(surface).toBeVisible();
      if (width === 390) {
        await surface.getByRole("tab", { name: "Prices", exact: true }).click();
        await expect(surface.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
        await surface.getByRole("tab", { name: "Overview", exact: true }).click();
      }
      const picker = surface.getByRole("region", { name: "Save this venue to a list" });
      await surface.getByRole("button", { name: `Save ${VENUE_NAME} to a list`, exact: true }).click();
      await expect(picker).toBeVisible();
      await picker.getByRole("textbox", { name: "New list name" }).fill(LIST);
      const create = picker.getByRole("button", { name: "Create & save", exact: true });
      await create.click({ trial: true });
      const before = await create.boundingBox();
      if (!before) throw new Error("Create & save has no painted box");
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      pointerHeld = true;
      releaseComparison();
      await expect(surface.locator(".venueAreaPriceCompare")).toBeVisible({ timeout: 30_000 });
      const after = await create.boundingBox();
      await page.mouse.up();
      pointerHeld = false;
      await testInfo.attach("comparison-arrival-geometry", {
        body: JSON.stringify({ before, after }), contentType: "application/json",
      });
      await expect(picker.getByRole("button", { name: /^✓?Want to Visit$/ }))
        .toHaveAttribute("aria-pressed", "true");
      await expect(picker.getByRole("textbox", { name: "New list name" })).toHaveValue("");
      expect(after).not.toBeNull();
      expect(Math.abs((after?.y ?? Number.NaN) - before.y)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), STORAGE_KEY))
        .toEqual([{ venueId: VENUE_ID, listType: LIST, savedAt: expect.any(String) }]);
      await page.screenshot({ path: testInfo.outputPath(`late-comparison-${width}.png`) });
    } finally {
      releaseComparison();
      if (pointerHeld) await page.mouse.up();
    }
  });
}
