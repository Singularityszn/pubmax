import { expect, test, type Locator, type Page } from "@playwright/test";

import { serveEstimatedPintFixture, serveNoPintBundleFixture } from "./helpers/pintBundleFixture";

import { priceBand, type PriceBand } from "../lib/priceBand";

// THE PRICE COLOUR LAW (captain, 5 Sept 2026, "I already told you"): RED means
// expensive, YELLOW means affordable and average, GREEN means cheap, and a
// price wears no other colour. lib/priceBand.ts is the one rule. This spec
// holds three phone surfaces to it at 390x844: the landing answer card, the
// venue sheet on /map?sel=venue-1vle947 and the near-you rail on
// /near?patch=soho. On each, a £6.50 pint reads expensive and the area's
// cheapest reads green, and the colour a reader sees is the band token, read
// off a probe element so the assertion is about paint and not a class name.

const VENUE_ID = "venue-1vle947";
const DAY_MS = 24 * 60 * 60 * 1000;

function dismissFirstRunChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
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

function poundsOf(text: string): number {
  const m = /£(\d+(?:\.\d+)?)/.exec(text);
  if (!m) throw new Error(`no figure in ${JSON.stringify(text)}`);
  return Number(m[1]);
}

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dismissFirstRunChrome(page);
});

test("landing: the £6.50 answer is red, the rail's cheapest is green, the trust chip wears no tone", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const answer = page.locator(".lpAnswerCard .lpPubPrice .priceBadge");
  await expect(answer).toHaveText("£6.50");
  await expectBand(page, answer, "expensive");

  // The standing is a word beside the figure, in the neutral badge ink.
  const standing = page.locator(".lpAnswerCard .lpStanding");
  await expect(standing).toHaveText("Listed");
  await expect(standing).toHaveClass(/^lpStanding$/);
  for (const band of ["cheap", "average", "expensive"] as const) {
    await expect(standing).not.toHaveCSS("color", await bandInk(page, band));
  }

  // The rail is the anchor's borough cheapest first, so its first row is green.
  const first = page.locator(".lpRailRow").first().locator(".priceBadge");
  expect(priceBand(poundsOf(await first.innerText()), { city: "london" })).toBe("cheap");
  await expectBand(page, first, "cheap");
});

test.describe("venue sheet on /map?sel=venue-1vle947", () => {
  test("the est. £6.50 pill is red, and the word says Estimated", async ({ page }) => {
    test.setTimeout(120_000);
    await serveEstimatedPintFixture(page, VENUE_ID);
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
    await serveNoPintBundleFixture(page, VENUE_ID);
    const drop = {
      id: "e3f592df-0dc3-434e-a6a4-a154e5358bbc",
      venueId: VENUE_ID,
      handle: "tester",
      drink: "Lager",
      measure: "pint",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      visibility: "public",
      createdAt: new Date(Date.now() - 4 * DAY_MS).toISOString(),
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      receiptPhotoUrl: null,
      venueName: "The Sir Christopher Hatton",
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

// Soho's five cheapest listed pints within a walk sit near London's cheap line
// (£5.20 to £5.95 today). The thresholds are the city's (docs/PRICE_BANDS.md)
// and are derived, never typed, so every figure is held to the band its own
// price earns.
test("near: every Soho figure wears the band its price earns, cheapest first", async ({ page }) => {
  const response = await page.goto("/near?patch=soho", { waitUntil: "commit" });
  expect(response?.status()).toBe(200);
  const cards = page.locator(".nmnCard");
  await expect(cards).toHaveCount(5);

  const figures = page.locator(".nmnCard .nmnCardPriceValue");
  const prices: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const figure = figures.nth(index);
    const price = poundsOf(await figure.innerText());
    prices.push(price);
    await expectBand(page, figure, priceBand(price, { city: "london" }) as PriceBand);
  }
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
});
