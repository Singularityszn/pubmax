import { expect, test } from "@playwright/test";
import { listEnabledCities } from "../lib/cities";
import { expectMapLoadingFrameReleased, mobileMapShellControl } from "./helpers/mobileMapShell";

for (const width of [1280, 390]) {
  test(`an indexed exact venue leads a loaded name match at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.addInitScript((cities) => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      const value = {
        cities,
        venues: [{ id: "venue-review-index-exact", name: "The", area: "Fixture", cityId: "london", venueKind: "pub", pintPrice: 4.7 }],
      };
      // v5 reproduces the old cached-index path. v6 exercises its replacement.
      for (const version of ["v5", "v6"]) {
        sessionStorage.setItem(`pubmax.surface.v1:map-search-index:${version}`, JSON.stringify({ value, storedAt: Date.now() }));
      }
    }, listEnabledCities().map((city) => ({ id: city.id, name: city.displayName })));
    await page.goto("/map");
    await expectMapLoadingFrameReleased(page);
    if (width < 1024) await (await mobileMapShellControl(page, "search")).click();
    const search = page.getByRole("combobox").first();
    await search.fill("The");
    await search.focus();
    const options = page.getByRole("group", { name: "Venues", exact: true }).getByRole("option");
    await expect.poll(() => options.count()).toBeGreaterThan(1);
    await expect(page.locator('[data-venue-id="venue-review-index-exact"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`indexed-pints-${width}.png`), fullPage: true });
    await expect(options.first()).toHaveAttribute("data-venue-id", "venue-review-index-exact");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", await options.first().getAttribute("id") ?? "");
  });
}
