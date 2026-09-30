import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });

for (const scenario of ["later keyboard focus", "stranded drawer focus", "modal focus"] as const) {
  test(`delayed toolbar preserves ${scenario}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let toolbarHeld = false;
    let documents = 0;
    page.on("request", (request) => { if (request.resourceType() === "document") documents += 1; });
    await page.route("**/*.js*", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes('"mapToolbarSearch"')) {
        toolbarHeld = true;
        await held;
      }
      await route.fulfill({ response, body });
    });
    try {
      await page.goto("/map/glasgow?sel=venue-glw-q7pz7s", { waitUntil: "domcontentloaded" });
      const close = page.locator(".mapDrawer .surfaceNavHome");
      await expect(close).toBeVisible({ timeout: 60_000 });
      await expect(close).toBeFocused();
      await expect.poll(() => toolbarHeld).toBe(true);
      await expect(page.locator("#mapSearchInput")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(false);
      const chosen = page.getByRole("button", { name: "Open command palette" });
      if (scenario !== "stranded drawer focus") {
        for (let tab = 0; tab < 30; tab += 1) {
          await page.keyboard.press("Tab");
          if (await chosen.evaluate((node) => node === document.activeElement)) break;
        }
        await expect(chosen).toBeFocused();
      }
      const modalSearch = page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox", { name: "Search commands" });
      if (scenario === "modal focus") {
        await page.keyboard.press("Enter");
        await expect(modalSearch).toBeFocused();
      }
      release();
      await expect(page.locator("#mapSearchInput")).toBeVisible({ timeout: 60_000 });
      // Cross the close/history animation frames after the toolbar mounts.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const expectedFocus = scenario === "modal focus" ? modalSearch
        : scenario === "later keyboard focus" ? chosen : page.locator("#mapSearchInput");
      await expect(expectedFocus).toBeFocused();
      expect(documents).toBe(1);
    } finally {
      release();
    }
  });
}
