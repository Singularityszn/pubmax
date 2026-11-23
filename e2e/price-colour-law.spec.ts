import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import {
  COMMUNITY_SHEET_FIXTURE_MAP_PATH,
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "@/e2e/helpers/communitySheetFixture";
import { storeThemeChoice } from "@/e2e/helpers/themeClock";
import type { PriceBand } from "@/lib/priceBand";
import type { SlimVenue } from "@/lib/venuesSlim";

// THE PRICE COLOUR LAW (captain, 5 Sept 2026, "I already told you"): RED means
// expensive, YELLOW means affordable and average, GREEN means cheap, and a
// price wears no other colour. lib/priceBand.ts is the one rule. This spec
// holds three phone surfaces to it at 390x844: the landing answer card, the
// venue sheet on the community-sheet fixture pub and the near-you rail on
// /near?patch=soho.

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const DAY_MS = 24 * 60 * 60 * 1000;
const COLOUR_CASES = [
  { price: 4.5, label: "£4.50", band: "cheap" },
  { price: 5.25, label: "£5.25", band: "cheap" },
  { price: 5.75, label: "£5.75", band: "average" },
  { price: 6.2, label: "£6.20", band: "average" },
  { price: 6.5, label: "£6.50", band: "expensive" },
] as const;

async function installColourPriceFixtures(page: Page, prices: readonly number[]): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-11-21T12:00:00Z"));
  const rows: SlimVenue[] = prices.map((price, index) => ({
    id: `venue-colour-fixture-${index}`,
    name: `Colour Fixture ${index + 1}`,
    lat: 51.5136 + index * 0.0001,
    lng: -0.134,
    borough: "Westminster",
    kind: "pub",
    cheapestPrice: price,
    measure: "pint",
    priceSource: "Fixture menu",
    priceObservedAt: "2026-11-20",
  }));
  const { revision } = JSON.parse(await readFile("public/data/venues_slim.json", "utf8")) as { revision: string };
  await page.route(/\/data\/venues_slim\.json(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { revision, rows } }),
  );
  await page.route("**/api/venue/venue-colour-fixture-*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Unknown colour fixture ${id}`);
    return route.fulfill({
      json: {
        venue: {
          prices: [{
            app_price_id: row.id,
            pint_name: "Lager",
            price_gbp: row.cheapestPrice,
            pub_url: "https://example.com/menu",
            scraped_at_values: "2026-11-20T12:00:00Z",
          }],
        },
      },
    });
  });
}

async function dismissFirstRunChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
}

/** The ink a band paints text with on this page, read off a probe element. */
async function bandInk(page: Page, band: PriceBand): Promise<string> {
  return page.evaluate((className) => {
    const probe = document.createElement("span");
    probe.className = className;
    probe.textContent = "£";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, `priceBand-${band}`);
}

async function expectBand(page: Page, figure: Locator, band: PriceBand): Promise<void> {
  await expect(figure).toBeVisible();
  await expect(figure).toHaveClass(new RegExp(`\\bpriceBand-${band}\\b`));
  for (const other of ["cheap", "average", "expensive"] as const) {
    if (other !== band) await expect(figure).not.toHaveClass(new RegExp(`\\bpriceBand-${other}\\b`));
  }
  const ink = await bandInk(page, band);
  await expect(figure).toHaveCSS("color", ink);
}

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await storeThemeChoice(page, "light");
  await dismissFirstRunChrome(page);
});

for (const sample of COLOUR_CASES) {
  test(`landing: ${sample.label} wears ${sample.band} on the answer, with neutral trust`, async ({ page, context }) => {
    await installColourPriceFixtures(page, Array(5).fill(sample.price));
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5136, longitude: -0.134 });
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.locator(".lpAnswerCard .lpPubName")).toHaveText("Colour Fixture 1");
    const answer = page.locator(".lpAnswerCard .lpPubPrice .priceBadge");
    await expect(answer).toHaveText(sample.label);
    await expectBand(page, answer, sample.band);

    const standing = page.locator(".lpAnswerCard .lpStanding");
    await expect(standing).toHaveText("Listed");
    await expect(standing).toHaveClass(/^lpStanding$/);
    for (const band of ["cheap", "average", "expensive"] as const) {
      await expect(standing).not.toHaveCSS("color", await bandInk(page, band));
    }


  });
}

const DROP_SERVINGS = [
  { drink: "Lager", measure: "pint", label: "Pint", band: "cheap" },
  { drink: "Lager", measure: "half", label: "Half", band: null },
  { drink: "Wine", measure: "125ml", label: "125 ml", band: null },
  { drink: "Wine", measure: "175ml", label: "175 ml", band: null },
  { drink: "Wine", measure: "250ml", label: "250 ml", band: null },
  { drink: "Lager", measure: "bottle", label: "Bottle", band: null },
  { drink: "Whisky", measure: "single", label: "Single", band: null },
  { drink: "Whisky", measure: "double", label: "Double", band: null },
  { drink: "Ale", measure: "other", measureLabel: "Schooner", label: "Schooner", band: null },
  { drink: "Half of lager", measure: "pint", label: "Pint", band: null },
  { drink: "330 ml lager", measure: "pint", label: "Pint", band: null },
  { drink: "Lager", label: "Measure unknown", band: null },
] as const;
for (const [index, serving] of DROP_SERVINGS.entries()) {
  test(`landing: ${serving.drink} (${serving.label}) retains its serving and pint colour eligibility`, async ({ page }) => {
    await page.route("**/api/pint-drops", (route) => route.fulfill({ json: { drops: [{
      id: `serving-${index}`, venueId: VENUE_ID, handle: "tester", priceGbp: 3,
      ...serving, passedDownNote: "A recent visit", provenance: "contributor", createdAt: "2026-11-20T12:00:00Z",
    }] } }));
    await page.goto("/");
    const card = page.locator(".dropStripCard");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`${serving.drink} · ${serving.label}`);
    const price = card.locator(".priceBadge");
    await expect(price).toHaveText("£3.00");
    if (serving.band) {
      await expectBand(page, price, serving.band);
    } else {
      await expect(price).not.toHaveClass(/\bpriceBand-(?:cheap|average|expensive)\b/);
    }
  });
}

test.describe(`venue sheet on ${COMMUNITY_SHEET_FIXTURE_MAP_PATH}`, () => {
  test("the est. £6.50 pill is red, and the word says Estimated", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/api/pint-drops**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drops: [] }) }),
    );
    const response = await page.goto(`/map?sel=${VENUE_ID}`);
    expect(response?.status()).toBe(200);

    const sheet = page.locator(".venueInspector").first();
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    const pill = sheet.locator('.trustPill[data-standing="estimate"]');
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toContainText("est. £6.50");
    await expect(pill).toContainText("Estimated");
    await expectBand(page, pill, "expensive");
  });

  test("a £4.50 pint logged here is green, on the sheet and on the phone peek", async ({ page }) => {
    test.setTimeout(120_000);
    const drop = {
      id: "e3f592df-0dc3-434e-a6a4-a154e5358bbc",
      venueId: VENUE_ID,
      handle: "tester",
      drink: "Lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      visibility: "public",
      createdAt: new Date(Date.now() - 4 * DAY_MS).toISOString(),
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      venueName: COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
      venueMapUrl: `/map?sel=${VENUE_ID}`,
    };
    await page.route("**/api/pint-drops**", (route) => {
      const venueId = new URL(route.request().url()).searchParams.get("venueId");
      const drops = venueId && venueId !== VENUE_ID ? [] : [drop];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drops }) });
    });
    const response = await page.goto(`/map?sel=${VENUE_ID}`);
    expect(response?.status()).toBe(200);

    const chip = page.locator(`.venueInspector [data-pint-trust="logged-once"][data-venue-id="${VENUE_ID}"]`);
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expectBand(page, chip.locator(".priceBadge"), "cheap");

    const peek = page.locator('.mobileVenuePeekSummary [data-pint-trust="logged-once"] .priceBadge');
    await expect(peek).toBeVisible({ timeout: 15_000 });
    await expect(peek).toHaveText("£4.50");
    await expectBand(page, peek, "cheap");
  });
});

test("near: controlled London pints follow docs/PRICE_BANDS.md, cheapest first", async ({ page }) => {
  await installColourPriceFixtures(page, COLOUR_CASES.map((sample) => sample.price).reverse());
  const response = await page.goto("/near?patch=soho", { waitUntil: "commit" });
  expect(response?.status()).toBe(200);
  const cards = page.locator(".nmnCard");
  await expect(cards).toHaveCount(5);

  const figures = page.locator(".nmnCard .nmnCardPriceValue");
  for (const [index, sample] of COLOUR_CASES.entries()) {
    const figure = figures.nth(index);
    await expect(figure).toHaveText(sample.label);
    await expectBand(page, figure, sample.band);
  }
});
