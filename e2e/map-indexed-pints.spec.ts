import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { listEnabledCities } from "../lib/cities";
import { expectMapLoadingFrameReleased, mobileMapShellControl } from "./helpers/mobileMapShell";

// Network fixtures must not be answered from a service worker cache.
test.use({ serviceWorkers: "block" });

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

  test(`a known sourced price ranks an indexed area match at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const core = JSON.parse(await readFile("public/data/venues_slim.core.json", "utf8")) as {
      revision: string; rows: Array<Record<string, unknown>>;
    };
    const base = core.rows.find((row) => !row.kind || row.kind === "pub");
    const rows = [["venue-aaaa111", "Review Alpha"], ["venue-zzzz222", "Review Zulu"]]
      .map(([id, name], index) => ({
        ...base, id, name, sourceName: undefined, kind: "pub", lat: 51.51 + index * 0.001,
        lng: -0.12, locality: "Reviewland", borough: "Westminster", cheapestPrice: null,
        priceSource: undefined, priceObservedAt: undefined,
      }));
    await page.route("**/data/venues_slim.core.json", (route) => route.fulfill({ json: { ...core, rows } }));
    await page.route(/\/data\/venues_slim\.cell\..*\.json/, (route) => route.fulfill({ json: { ...core, rows } }));
    await page.route("**/data/price_updates/latest.json", (route) => route.fulfill({ json: {
      updates: [{ venueKey: "venue-zzzz222", price: 4.7,
        source: { label: "Local review fixture", url: "https://example.com/menu" },
        observedAt: new Date().toISOString() }],
    } }));
    await page.addInitScript(({ cities, rows }) => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax.surface.v1:map-search-index:v6", JSON.stringify({
        storedAt: Date.now(), value: { cities, venues: rows.map((row) => ({
          id: row.id, name: row.name, cityId: "london", area: "Reviewland", venueKind: "pub",
        })) },
      }));
    }, { cities: listEnabledCities().map((city) => ({ id: city.id, name: city.displayName })), rows });
    await page.goto("/map");
    await expectMapLoadingFrameReleased(page);
    if (width < 1024) await (await mobileMapShellControl(page, "search")).click();
    const search = page.getByRole("combobox").first();
    await search.fill("Review");
    await expect(page.locator('[data-venue-id="venue-zzzz222"]')).toContainText("£4.70");
    await search.fill("Reviewland");
    const first = page.getByRole("group", { name: "Venues", exact: true }).getByRole("option").first();
    await expect(first).toHaveAttribute("data-venue-id", "venue-zzzz222");
    await page.screenshot({ path: testInfo.outputPath(`known-price-${width}.png`), fullPage: true });
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", await first.getAttribute("id") ?? "");
  });
}
