import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { PRICE_AUTHORITY_MAX_AGE_MS } from "../lib/priceAuthorityWindow";
import { LISTED_MAX_AGE_DAYS } from "../lib/priceTier";
import { dismissMapIntroductions } from "./helpers/mapIntroDismissal";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { desktopVenueDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";
import { expectMapToolbarReady, mapToolbar } from "./helpers/mapToolbar";

type ListedQuote = {
  venueId: string; category: string; priceGbp: number; sourceUrl: string;
  observedAt: string; servingSize?: string | null; drinkLabel?: string | null;
};
type PriceIndex = {
  listedPrices: ListedQuote[];
  prices: { venueId: string; drinkCategory: string; submittedAt: number; mapCandidate?: { submittedAt: number } }[];
  truncated: boolean;
  degraded?: boolean;
};
const venueId = "venue-1qge8u";
const sourceUrl = "https://www.thealbionpub.com/uploads/drink.pdf?v=1772220206";
const sourceRows = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as (ListedQuote & { standing: string })[];
const source = sourceRows.filter((row) => row.venueId === venueId && row.category === "gin"
  && row.standing === "listed" && row.drinkLabel === "GORDONS" && row.servingSize === "25ml"
  && Math.round(row.priceGbp * 100) === 400 && row.sourceUrl === sourceUrl)
  .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
if (!source) throw new Error("Official Albion GORDONS £4.00 / 25ml fixture is missing");
const observed = Date.parse(source.observedAt);
const boundary = observed + LISTED_MAX_AGE_DAYS * 86_400_000;
const before = boundary - 1_000;
const after = boundary + 1_000;

function expectCompleteFixture({ status, body }: { status: number; body: PriceIndex }) {
  expect(status, "Fixture precondition: actual category read must succeed").toBe(200);
  expect(body.degraded, "Fixture precondition: category read must be complete").not.toBe(true);
  expect(body.truncated, "Fixture precondition: category read must not be partial").toBe(false);
  const quoted = body.listedPrices.filter((quote) => quote.venueId === venueId && quote.category === "gin");
  expect(quoted.some((quote) => quote.sourceUrl === sourceUrl && quote.observedAt === source.observedAt
    && quote.drinkLabel === "GORDONS" && quote.servingSize === "25ml" && Math.round(quote.priceGbp * 100) === 400)).toBe(true);
  expect(quoted.every((quote) => Number.isFinite(Date.parse(quote.observedAt)) && Date.parse(quote.observedAt) <= observed),
    "Fixture precondition: no newer listed Gin authority may outlive the chosen boundary").toBe(true);
  for (const row of body.prices.filter((row) => row.venueId === venueId && row.drinkCategory === "gin")) {
    const times = [row.submittedAt, ...(row.mapCandidate ? [row.mapCandidate.submittedAt] : [])];
    expect(times.every((time) => Number.isFinite(time) && time < before - PRICE_AUTHORITY_MAX_AGE_MS),
      "Fixture precondition: no eligible community Gin authority at the QA clock").toBe(true);
  }
}

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

test("Gin category return retires an expired listed quote in the same Map session", async ({ page }, info) => {
  test.setTimeout(90_000);
  expect(Number.isFinite(observed)).toBe(true);
  await installDeterministicMapBasemap(page);
  // Browser Date only. Server/provider time and running timers stay unchanged.
  await page.clock.setFixedTime(before);
  const reads: Promise<{ status: number; body: PriceIndex }>[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/price-submit" && url.searchParams.get("drinkCategory") === "gin") {
      reads.push(response.json().then((body: PriceIndex) => ({ status: response.status(), body })));
    }
  });
  const initialIndex = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/price-submit" && url.searchParams.get("drinkCategory") === "gin"
      && url.searchParams.get("serving") === "25ml";
  });
  const detail = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/venue/${venueId}`);
  expect((await page.goto(`/map?drink=gin&serving=25ml&sel=${venueId}`))?.status()).toBe(200);
  const initialResponse = await initialIndex;
  expectCompleteFixture({ status: initialResponse.status(), body: await initialResponse.json() as PriceIndex });
  const detailResponse = await detail;
  expect(detailResponse.status()).toBe(200);
  expect((await detailResponse.json()).venue).toMatchObject({ id: venueId, name: "The Albion" });
  await dismissMapIntroductions(page);
  await expectSoleDesktopDrawer(page, "venue");
  const drawer = desktopVenueDrawer(page);
  await expect(async () => {
    await drawer.getByRole("button", { name: /^(Close pub detail|Close and return to the London map)$/ }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await dismissMapIntroductions(page);
  await expectMapToolbarReady(page);
  const search = mapToolbar(page).getByRole("combobox", { name: "Search places" });
  const albion = page.getByRole("listbox", { name: "Search suggestions" })
    .getByRole("group", { name: "Venues", exact: true })
    .locator(`[role="option"][data-venue-id="${venueId}"]`);
  await search.fill("Albion");
  await expect(albion).toBeVisible();
  await expect(albion.locator(".mapSearchSuggestPrice")).toHaveText("Gin · £4.00 · 25ml");
  const mountedMap = await page.locator("main#main").elementHandle();
  if (!mountedMap) throw new Error("Map DOM owner is absent");

  await search.fill("");
  await page.clock.setFixedTime(after);
  await dismissMapIntroductions(page);
  const trigger = mapToolbar(page).getByRole("button", { name: /^Drink:/ });
  const lane = page.locator(".mapToolbar .drinkLanePicker");
  await expect(async () => {
    if (!(await lane.isVisible())) await trigger.click();
    await expect(lane).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const categories = lane.getByRole("group", { name: "Drink prices shown on the map" });
  await categories.getByRole("button", { name: "Pints", exact: true }).click();
  await expect(categories.getByRole("button", { name: "Pints", exact: true })).toHaveAttribute("aria-pressed", "true");
  await categories.getByRole("button", { name: "Gin", exact: true }).click();
  await expect(categories.getByRole("button", { name: "Gin", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(lane.locator(".drinkLanePickerStatus")).toHaveCount(0);
  const serving = lane.getByRole("group", { name: "Serving size for price comparison" });
  await serving.getByRole("button", { name: "25ml", exact: true }).click();
  await expect(serving.getByRole("button", { name: "25ml", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(lane.locator(".drinkLanePickerStatus")).toHaveCount(0);
  await trigger.click();
  await expect(lane).not.toBeVisible();

  const indexes = await Promise.all(reads);
  expect(indexes.length).toBeGreaterThan(0);
  for (const index of indexes) expectCompleteFixture(index);
  // Retain the actual Map DOM owner; the test never reloads to age the cache.
  expect(await mountedMap.evaluate((node) => node.isConnected)).toBe(true);
  expect(await page.evaluate(() => Date.now())).toBe(after);
  await search.fill("Albion");
  await expect(albion).toBeVisible();
  const caption = albion.locator(".mapSearchSuggestPrice");
  await info.attach("same-session-price-expiry", {
    contentType: "application/json",
    body: JSON.stringify({ source: { venueId, sourceUrl, observedAt: source.observedAt, serving: "25ml", priceGbp: 4 }, before, after, actualCaption: await caption.innerText(), actualCategoryReads: indexes.length }),
  });
  await expect(caption).toHaveText("No gin price logged");
  await expect(albion).not.toContainText("£4.00");
  await expect(albion).not.toContainText("£5.40");
});
