import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import type { SlimVenue } from "../lib/venuesSlim";
import { COMMUNITY_SHEET_FIXTURE_VENUE_ID, COMMUNITY_SHEET_FIXTURE_VENUE_NAME } from "./helpers/communitySheetFixture";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased, mobileMapShellControl, routeTubeStatus } from "./helpers/mobileMapShell";
import { expectStreamedPageSettled } from "./helpers/streamedPage";

test.use({
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
  hasTouch: true,
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});
test.setTimeout(180_000);

const HERE = { latitude: 51.5136, longitude: -0.1365 };
// These known venue IDs let the final selection open the real venue endpoint.
// Coordinates, feature flags and prices below are synthetic network fixtures.
const UNPRICED = { id: COMMUNITY_SHEET_FIXTURE_VENUE_ID, name: COMMUNITY_SHEET_FIXTURE_VENUE_NAME };
const CHEAP = { id: "venue-1vle947", name: "The Sir Christopher Hatton" };
const SAVES_KEY = "pubmax:savedPubs:v1";
const INTENT_KEY = "pubmax:planning-intent:v1";

function fixturePub(id: string, name: string, north: number, price: number | null, garden = false): SlimVenue {
  return {
    id, name, lat: HERE.latitude + north, lng: HERE.longitude,
    kind: "pub", borough: "Westminster", cheapestPrice: price,
    ...(price !== null ? { priceSource: "Fixture menu", priceObservedAt: "2026-10-29" } : {}),
    filterHints: {
      searchText: `${name.toLowerCase()} westminster`,
      amenities: { food: false, cocktails: false, beerGarden: garden, nonAlcoholic: false },
      beerGardenSource: [garden, "OpenStreetMap", "2026-10-29"],
      curation: { nearWater: false, hasStory: false },
      canonical: false,
    },
  };
}

const ROWS: SlimVenue[] = [
  fixturePub(CHEAP.id, CHEAP.name, 0.004, 3.2, true),
  fixturePub(UNPRICED.id, UNPRICED.name, 0.0002, null),
  fixturePub("venue-nearest-fixture-middle", "Fixture Middle Pub", 0.003, 5.6),
  fixturePub("venue-nearest-fixture-dear", "Fixture Dear Pub", 0.001, 7),
];

async function prepare(page: Page, width: number, options: {
  savedIds?: string[];
  fixtureIndex?: boolean;
  location?: { latitude: number; longitude: number };
} = {}) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation(options.location ?? HERE);
  await page.addInitScript(({ savedIds, savesKey }) => {
    // Each test owns an empty browser context. Existing device data is not used.
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem(savesKey, JSON.stringify(savedIds.map((venueId) => ({
      venueId, listType: "Want to Visit", savedAt: "2026-10-29T12:00:00.000Z",
    }))));
  }, { savedIds: options.savedIds ?? [], savesKey: SAVES_KEY });

  await installDeterministicMapBasemap(page);
  await routeTubeStatus(page, "routine");
  await page.route("**/api/whats-on**", (route) => route.fulfill({
    json: { rows: [], servedAt: new Date().toISOString() },
  }));
  if (options.fixtureIndex === false) return errors;
  await page.route("**/data/price_updates/latest.json*", (route) => route.fulfill({ json: { updates: [] } }));

  // Exercise the production index readers, SlimVenue conversion, Map filters
  // and the actual NearMeNow caller. Do not inject ranker output or React props.
  const core = JSON.parse(await readFile("public/data/venues_slim.core.json", "utf8")) as Record<string, unknown>;
  const manifest = JSON.parse(await readFile("public/data/venues_slim.manifest.json", "utf8")) as Record<string, unknown>;
  await page.route(/\/data\/venues_slim\.manifest\.json(?:\?.*)?$/, (route) => route.fulfill({
    json: {
      ...manifest,
      shards: [{ id: "nearest-pub-fixture", core: true, partition: "grid", url: "/data/venues_slim.core.json",
        count: ROWS.length, bbox: [-0.4, 51.3, 0.2, 51.8] }],
    },
  }));
  await page.route(/\/data\/venues_slim\.json(?:\?.*)?$/, (route) => route.fulfill({ json: { ...core, rows: ROWS } }));
  await page.route(/\/data\/venues_slim\.(?!manifest\.)[^/?]+\.json(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { ...core, rows: ROWS } }));
  return errors;
}

function nearest(answer: Locator) {
  return answer.getByRole("region", { name: "Nearest listed pub", exact: true });
}

async function openMap(page: Page) {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expectMapLoadingFrameReleased(page);
  const filters = await mobileMapShellControl(page, "filters");
  await expect(filters).toBeVisible();
}

async function openMapAnswer(page: Page) {
  const control = await mobileMapShellControl(page, "nearMe");
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="near-me"]');
  await expect(async () => {
    if (!(await sheet.isVisible())) await control.tap();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(nearest(sheet)).toBeVisible({ timeout: 30_000 });
  return sheet;
}

async function closeSheet(page: Page, sheet: Locator) {
  await sheet.getByRole("button", { name: "Close and return to the map", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(await mobileMapShellControl(page, "nearMe")).toBeVisible();
}

async function openFilters(page: Page) {
  const control = await mobileMapShellControl(page, "filters");
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(async () => {
    if (!(await sheet.isVisible())) await control.tap();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  return sheet;
}

async function expectSeparateAnswers(answer: Locator) {
  await expect(nearest(answer)).toContainText(UNPRICED.name);
  await expect(nearest(answer)).toContainText("About 1 min");
  await expect(nearest(answer)).not.toContainText("£");
  const priced = answer.locator(".nmnList > li");
  await expect(priced).toHaveCount(3);
  await expect(priced.first()).toContainText(CHEAP.name);
  await expect(priced.first()).toContainText("£3.20");
  await expect(priced.filter({ hasText: UNPRICED.name })).toHaveCount(0);
}

for (const width of [390, 1440]) {
  test(`Near keeps the nearest pub separate from the cheapest pint at ${width}px`, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "fixture", description: "Synthetic city index and location. Venue IDs resolve through the real venue endpoint." });
    const errors = await prepare(page, width);
    const response = await page.goto("/near?locate=1");
    expect(response?.status()).toBe(200);
    await expectStreamedPageSettled(page);
    const answer = page.getByRole("region", { name: "Find nearby cheap pints", exact: true });
    await expectSeparateAnswers(answer);
    await expect(nearest(answer).getByRole("button", { name: /View pub/ })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`near-separate-answers-${width}.png`), fullPage: true });
    await nearest(answer).getByRole("button", { name: /View pub/ }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/map" && url.searchParams.get("sel") === UNPRICED.id);
    await expect(page.getByRole("heading", { name: UNPRICED.name, exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).toBeNull();
    expect(errors).toEqual([]);
  });
}

test("phone Map supplies the nearer unpriced pub through its default filters and opens that exact venue", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "fixture", description: "Real Map location control and default filter pipeline over four synthetic city-index rows." });
  const errors = await prepare(page, 390);
  await openMap(page);
  const answer = await openMapAnswer(page);
  await expectSeparateAnswers(answer);
  await expect(nearest(answer).getByRole("button", { name: /View pub/ })).toBeInViewport();
  await expect(answer.locator(".nmnAccept")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("map-default-nearest.png") });
  await nearest(answer).getByRole("button", { name: /View pub/ }).tap();
  await expect(page).toHaveURL((url) => url.pathname === "/map" && url.searchParams.get("sel") === UNPRICED.id);
  const detail = page.getByRole("dialog", { name: "Pub detail", exact: true });
  await expect(detail.getByRole("heading", { name: UNPRICED.name, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(answer).toBeHidden();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).toBeNull();
  expect(errors).toEqual([]);
});

test("phone Map refreshes its nearest supplied pub after Saved only and feature filters change", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "fixture", description: "Saved state and garden evidence are test fixtures. No account save or venue write occurs." });
  const errors = await prepare(page, 390, { savedIds: [CHEAP.id] });
  await openMap(page);
  let answer = await openMapAnswer(page);
  await expect(nearest(answer)).toContainText(UNPRICED.name);
  await closeSheet(page, answer);

  let filters = await openFilters(page);
  const savedOnly = filters.getByRole("checkbox", { name: "Show only venues you have saved", exact: true });
  await expect(savedOnly).not.toBeChecked();
  await savedOnly.check();
  await expect(savedOnly).toBeChecked();
  await closeSheet(page, filters);
  answer = await openMapAnswer(page);
  await expect(nearest(answer)).toContainText(CHEAP.name);
  await expect(nearest(answer)).not.toContainText(UNPRICED.name);
  await page.screenshot({ path: testInfo.outputPath("map-saved-only-nearest.png") });
  await closeSheet(page, answer);

  filters = await openFilters(page);
  await filters.getByRole("checkbox", { name: "Show only venues you have saved", exact: true }).uncheck();
  await closeSheet(page, filters);
  answer = await openMapAnswer(page);
  await expect(nearest(answer)).toContainText(UNPRICED.name);
  await closeSheet(page, answer);

  filters = await openFilters(page);
  const garden = filters.getByRole("button", { name: "Beer garden", exact: true });
  await expect(garden).toHaveAttribute("aria-pressed", "false");
  await garden.click();
  await expect(garden).toHaveAttribute("aria-pressed", "true");
  await closeSheet(page, filters);
  answer = await openMapAnswer(page);
  await expect(nearest(answer)).toContainText(CHEAP.name);
  await expect(nearest(answer)).not.toContainText(UNPRICED.name);
  await page.screenshot({ path: testInfo.outputPath("map-garden-nearest.png") });
  await closeSheet(page, answer);

  filters = await openFilters(page);
  await filters.getByRole("button", { name: "Clear features", exact: true }).click();
  await closeSheet(page, filters);
  answer = await openMapAnswer(page);
  await expectSeparateAnswers(answer);
  await page.screenshot({ path: testInfo.outputPath("map-cleared-nearest.png") });
  expect(errors).toEqual([]);
});

test("phone Map includes the known unpriced pub from the committed London index under default filters", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "data", description: "Committed London packs and venue endpoint. Only the location, basemap and unrelated feeds are controlled." });
  const payload = JSON.parse(await readFile("public/data/venues_slim.json", "utf8")) as SlimVenue[] | { rows: SlimVenue[] };
  const rows = Array.isArray(payload) ? payload : payload.rows;
  const venue = rows.find((row) => row.id === UNPRICED.id);
  if (!venue) throw new Error("The committed London index must contain the shared unpriced-pub fixture");
  // This is a known public pub, selected at its own listed coordinates. The
  // fixture guard separately keeps it free of harvested and overlay prices.
  expect(venue.cheapestPrice).toBeNull();
  expect(venue.kind === undefined || venue.kind === "pub").toBe(true);
  const errors = await prepare(page, 390, {
    fixtureIndex: false,
    location: { latitude: venue.lat, longitude: venue.lng },
  });
  await openMap(page);
  const answer = await openMapAnswer(page);
  await expect(nearest(answer)).toContainText(UNPRICED.name);
  await expect(nearest(answer)).toContainText("right here");
  await expect(nearest(answer)).not.toContainText("£");
  await expect(answer.locator(".nmnList > li").first()).toContainText("£");
  await page.screenshot({ path: testInfo.outputPath("map-committed-index-nearest.png") });
  await nearest(answer).getByRole("button", { name: /View pub/ }).tap();
  await expect(page).toHaveURL((url) => url.pathname === "/map" && url.searchParams.get("sel") === UNPRICED.id);
  await expect(page.getByRole("dialog", { name: "Pub detail", exact: true })
    .getByRole("heading", { name: UNPRICED.name, exact: true })).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
