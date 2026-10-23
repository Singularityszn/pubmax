import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { listEnabledCities } from "../lib/cities";
import { expectMapLoadingFrameReleased, mobileMapShellControl } from "./helpers/mobileMapShell";

test.use({ serviceWorkers: "block" });

type FixtureVenue = {
  id: string;
  name: string;
  area: string;
  pintPrice?: number;
  lat?: number;
  venueKind?: "pub" | "bar" | "restaurant";
};

async function searchFixture(page: Page, loaded: FixtureVenue[], indexed: FixtureVenue[]) {
  const core = JSON.parse(await readFile("public/data/venues_slim.core.json", "utf8"));
  const base = core.rows.find((row: { kind?: string }) => !row.kind || row.kind === "pub");
  const rows = loaded.map((venue) => ({
    ...base, id: venue.id, name: venue.name, sourceName: undefined, kind: venue.venueKind ?? "pub",
    lat: venue.lat ?? 51.5147, lng: -0.12, locality: venue.area, borough: "Westminster",
    cheapestPrice: venue.pintPrice ?? null, priceSource: undefined, priceObservedAt: undefined,
  }));
  const manifest = JSON.parse(await readFile("public/data/venues_slim.manifest.json", "utf8"));
  await page.route(/\/data\/venues_slim\.manifest\.json(?:\?.*)?$/, (route) => route.fulfill({ json: {
    ...manifest,
    shards: [{ id: "fixture", core: true, partition: "grid", url: "/data/venues_slim.core.json",
      count: rows.length, bbox: [-0.4, 51.3, 0.2, 51.8] }],
  } }));
  await page.route("**/data/venues_slim.json", (route) => route.fulfill({ json: { ...core, rows } }));
  await page.route(/\/data\/venues_slim\.(?!manifest\.)[^/?]+\.json(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { ...core, rows } }));
  await page.addInitScript(({ cities, indexed }) => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax.surface.v1:map-search-index:v6", JSON.stringify({
      storedAt: Date.now(), value: { cities, venues: indexed.map((venue) => ({
        ...venue, cityId: "london", venueKind: venue.venueKind ?? "pub",
      })) },
    }));
  }, { cities: listEnabledCities().map((city) => ({ id: city.id, name: city.displayName })), indexed });
}

for (const width of [1280, 390]) {
  test(`Pints ranks a sourced pub above nearer unpriced pubs, bars and food at ${width}px`, async ({ page }, info) => {
    const rows: FixtureVenue[] = [
      { id: "venue-kind-bar", name: "Fixture Cocktails", area: "Westminster", venueKind: "bar", pintPrice: 10, lat: 51.52 },
      { id: "venue-kind-food", name: "Fixture Kitchen", area: "Westminster", venueKind: "restaurant", pintPrice: 12, lat: 51.52 },
      { id: "venue-kind-unpriced", name: "Fixture Unpriced Arms", area: "Westminster", lat: 51.52 },
      { id: "venue-kind-priced", name: "Fixture Priced Arms", area: "Westminster", pintPrice: 5.2, lat: 51.54 },
    ];
    await searchFixture(page, rows, rows);
    const search = await openSearch(page, "beer", width);
    await search.fill("fixture");
    const options = page.getByRole("group", { name: "Venues", exact: true }).getByRole("option");
    await expect(options.first()).toHaveAttribute("data-venue-id", "venue-kind-priced");
    await expect(options.nth(1)).toHaveAttribute("data-venue-id", "venue-kind-unpriced");
    await expect(options.first()).toContainText("£5.20");
    await expect(options.filter({ hasText: "Fixture Kitchen" })).toContainText("Restaurant");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", await options.first().getAttribute("id") ?? "");
    await page.screenshot({ path: info.outputPath("pints-kind-order.png"), fullPage: true });
  });
}

async function openSearch(page: Page, drink: string, width = 1280) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
  await page.goto(`/map?drink=${drink}`);
  await expectMapLoadingFrameReleased(page);
  if (width < 1024) await (await mobileMapShellControl(page, "search")).click();
  return page.getByRole("combobox").first();
}

for (const drink of ["beer", "wine"]) {
  test(`exact, prefix, word-prefix, substring and area discovery keep keyboard order in ${drink}`, async ({ page }, info) => {
    const substring = { id: "venue-tier-substring", name: "Riverside", area: "Side", pintPrice: 5 };
    await searchFixture(page, [substring], [
      { id: "venue-tier-area", name: "A Tavern", area: "Side", pintPrice: 4 },
      substring,
      { id: "venue-tier-word", name: "The Side Arms", area: "Westminster", pintPrice: 5 },
      { id: "venue-tier-prefix", name: "Side House", area: "Westminster", pintPrice: 5 },
      { id: "venue-tier-exact", name: "Side", area: "Westminster", pintPrice: 5 },
    ]);
    const search = await openSearch(page, drink);
    await search.fill("side");
    const options = page.getByRole("group", { name: "Venues", exact: true }).getByRole("option");
    const expected = drink === "beer"
      ? ["venue-tier-exact", "venue-tier-prefix", "venue-tier-word", "venue-tier-substring", "venue-tier-area"]
      : ["venue-tier-exact", "venue-tier-substring", "venue-tier-prefix", "venue-tier-word", "venue-tier-area"];
    await expect.poll(() => options.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-venue-id"))))
      .toEqual(expected);
    for (let i = 0; i < expected.length; i += 1) {
      await search.press("ArrowDown");
      await expect(search).toHaveAttribute("aria-activedescendant", await options.nth(i).getAttribute("id") ?? "");
    }
    await page.screenshot({ path: info.outputPath("name-tier-matrix.png"), fullPage: true });
  });

  for (const withIndex of [false, true]) {
    test(`George prefix order and keyboard order survive ${drink}, index ${withIndex}`, async ({ page }, info) => {
      const loaded = [
        { id: "venue-george-iv", name: "The George IV", area: "Westminster", pintPrice: 5.2, lat: 51.52 },
        { id: "venue-george-dragon", name: "George and Dragon, Fitzrovia", area: "Westminster", lat: 51.54 },
      ];
      await searchFixture(page, loaded, withIndex ? [
        ...loaded,
        { id: "venue-george-indexed", name: "George Street Arms", area: "Westminster", pintPrice: 4.7 },
      ] : []);
      const search = await openSearch(page, drink);
      await search.fill("geor");
      const options = page.getByRole("group", { name: "Venues", exact: true }).getByRole("option");
      const expected = !withIndex ? ["venue-george-iv", "venue-george-dragon"]
        : drink === "beer" ? ["venue-george-iv", "venue-george-indexed", "venue-george-dragon"]
          : ["venue-george-iv", "venue-george-dragon", "venue-george-indexed"];
      await expect.poll(() => options.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-venue-id"))))
        .toEqual(expected);
      for (let i = 0; i < expected.length; i += 1) {
        await search.press("ArrowDown");
        await expect(search).toHaveAttribute("aria-activedescendant", await options.nth(i).getAttribute("id") ?? "");
      }
      await page.screenshot({ path: info.outputPath("george-order.png"), fullPage: true });
    });
  }

  for (const loadedId of ["venue-riverside-priced", "venue-riverside-unpriced"]) {
    test(`Riverside name tier beats Side area through index truncation in ${drink}, loaded ${loadedId}`, async ({ page }, info) => {
      const pair = [
        { id: "venue-riverside-priced", name: "The Riverside Arms", area: "Westminster", pintPrice: 5.2 },
        { id: "venue-riverside-unpriced", name: "East Riverside Inn", area: "Side" },
      ];
      const areaOnly = Array.from({ length: 15 }, (_, i) => ({
        id: `venue-side-area-${i}`, name: `A Tavern ${String(i).padStart(2, "0")}`, area: "Side", pintPrice: 4,
      }));
      await searchFixture(page, pair.filter((venue) => venue.id === loadedId), [...areaOnly, ...pair]);
      const search = await openSearch(page, drink, loadedId === "venue-riverside-priced" ? 390 : 1280);
      await search.fill("side");
      const options = page.getByRole("group", { name: "Venues", exact: true }).getByRole("option");
      const expected = drink === "beer" || loadedId === "venue-riverside-priced"
        ? ["venue-riverside-priced", "venue-riverside-unpriced"]
        : ["venue-riverside-unpriced", "venue-riverside-priced"];
      await expect.poll(() => options.evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getAttribute("data-venue-id"))))
        .toEqual(expected);
      await expect(options.filter({ hasText: "A Tavern" }).first()).toBeVisible();
      for (let i = 0; i < 3; i += 1) {
        await search.press("ArrowDown");
        await expect(search).toHaveAttribute("aria-activedescendant", await options.nth(i).getAttribute("id") ?? "");
      }
      await page.screenshot({ path: info.outputPath("riverside-order.png"), fullPage: true });
    });
  }
}
