import { expect, test, type Page } from "@playwright/test";
import { CATEGORY_META, MAP_LENS_DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";

import {
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";
import { installAuthDoubles } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

/**
 * ONE PRICE DOOR PER TRUST STATE, on the venue Overview at 390 (captain's rule
 * from the core-loop battle test L03, 5 Sept 2026: one button system, one
 * clear primary per screen).
 *
 * Five states are driven through the same sheet, signed in through the auth
 * doubles so the account rules admit the composer: no price on record, a
 * listed bundle price alone, and the three Pint Drop states (logged once,
 * confirmed, aged out) over the community-sheet fixture pub, whose drops are served
 * by a route mock in the shape /api/pint-drops answers. For each, exactly one
 * `[data-price-door]` is visible, the composer is folded behind it, the sticky
 * bar carries no price action, and the retired invitations never return.
 * Taking the log door unfolds the form and folds the door away; the confirm
 * door (#1492) still lands on the Pint Drop composer's price step with the
 * figure seeded.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

const HATTON = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const UNPRICED = "venue-1kt3p9o";
const LISTED_ONLY = "venue-133bdp8";
const DAY_MS = 24 * 60 * 60 * 1000;

type DropRow = Record<string, unknown>;

function row(overrides: DropRow = {}): DropRow {
  return {
    id: "e3f592df-0dc3-434e-a6a4-a154e5358bbc",
    venueId: HATTON,
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
    venueMapUrl: `/map?sel=${HATTON}`,
    ...overrides,
  };
}

const confirmation = {
  confirmationId: "conf-1",
  confirmedAt: new Date(Date.now() - DAY_MS).toISOString(),
  basis: "second_reporter",
  confirmingDropId: "drop-2",
};

const STATES = {
  none: { venueId: UNPRICED, drops: [] as DropRow[], door: "log" },
  listed: { venueId: LISTED_ONLY, drops: [] as DropRow[], door: "log" },
  "logged-once": { venueId: HATTON, drops: [row()], door: "confirm" },
  // TWO DRINKERS, TWO PRICES (captain 7 Sept 2026). The pub Grok read on the
  // 08:37 deploy: it said "Logged once" over £4.50 and £4.70 and offered
  // "Still £4.70?". Its door now asks which of the two the reader paid.
  disputed: {
    venueId: HATTON,
    drops: [
      row({ priceGbp: 4.7 }),
      row({
        id: "drop-2",
        handle: "second_drinker",
        authorityKey: "account-second",
        priceGbp: 4.5,
        createdAt: new Date(Date.now() - 5 * DAY_MS).toISOString(),
      }),
    ],
    door: "choose",
  },
  confirmed: {
    venueId: HATTON,
    drops: [
      row({ confirmation, createdAt: new Date(Date.now() - 2 * DAY_MS).toISOString() }),
      row({
        id: "drop-2",
        handle: "second_drinker",
        authorityKey: "account-second",
        confirmation,
        createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
      }),
    ],
    door: "log",
  },
  "aged-out": {
    venueId: HATTON,
    drops: [row({ createdAt: new Date(Date.now() - 90 * DAY_MS).toISOString() })],
    door: "confirm",
  },
} as const;

type StateName = keyof typeof STATES;

/** Every price action the battle test counted, none of which may be visible. */
const RETIRED = [
  /^Add a price at/i,
  /^Or leave a Pint Drop$/i,
  /^Log a beer price$/i,
  /^Log it$/,
];

async function serveDrops(page: Page, venueId: string, drops: DropRow[]): Promise<void> {
  await page.route("**/api/pint-drops**", async (route) => {
    const url = new URL(route.request().url());
    const forVenue = url.searchParams.get("venueId");
    const body = forVenue && forVenue !== venueId ? [] : drops;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: body }),
    });
  });
}

async function openVenueSheet(page: Page) {
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible({ timeout: 30_000 });
  const inspector = venueSheet.locator(".venueInspector");
  const expand = venueSheet.getByRole("button", { name: "Expand sheet" });
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()))
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return venueSheet;
}

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

test("keeps the price neutral until the selected pub's drops answer", async ({ page }) => {
  let releaseRead: () => void = () => {};
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route("**/api/pint-drops**", async (route) => {
    const selected = new URL(route.request().url()).searchParams.get("venueId") === HATTON;
    if (selected) await heldRead;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: selected ? [row({ priceGbp: 4.7 })] : [] }),
    });
  });
  try {
    await page.goto(`/map?sel=${HATTON}`);
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    const peek = sheet.locator(".mobileVenuePeekSummary");
    await expect(peek).toContainText("Checking prices", { timeout: 10_000 });
    await expect(peek).not.toContainText(/est\.|No price yet/);
    await expect(sheet.locator(".venueInspector")).not.toContainText(/est\. £/);
    releaseRead();
    await expect(peek).toContainText("£4.70", { timeout: 20_000 });
    await expect(peek).not.toContainText("Checking prices");
  } finally {
    releaseRead();
  }
});

test("city-wide confirmed pint stays visible while selected venue details load", async ({ page }) => {
  await installDeterministicMapBasemap(page);
  let detailRequested = false;
  let detailSettled = false;
  let releaseRead: () => void = () => {};
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  const confirmedDrops = STATES.confirmed.drops.map((drop) => ({ ...drop, priceGbp: 4.7 }));
  await page.route("**/api/pint-drops**", async (route) => {
    const venueId = new URL(route.request().url()).searchParams.get("venueId");
    if (venueId === HATTON) await heldRead;
    await route.fulfill({ json: { drops: !venueId || venueId === HATTON ? confirmedDrops : [] } });
  });
  await page.route(`**/api/venue/${HATTON}*`, async (route) => {
    detailRequested = true;
    await heldRead;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    await route.fulfill({ json: {
      ...payload,
      venue: {
        ...payload.venue, prices: [], cheapestPrice: null, cheapestPint: "", averagePrice: null,
        sourcedPrice: null, bundlePrices: {},
      },
    } });
    detailSettled = true;
  });
  try {
    const cityDrops = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/pint-drops" && !url.searchParams.has("venueId");
    });
    await page.goto("/map");
    await cityDrops;
    const searchButton = page.getByRole("button", { name: "Search the map", exact: true });
    await expect(async () => {
      await searchButton.click();
      await expect(page.getByRole("combobox", { name: "Search pubs" })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("combobox", { name: "Search pubs" }).fill(COMMUNITY_SHEET_FIXTURE_VENUE_NAME);
    const option = page.getByRole("listbox", { name: "Search suggestions" })
      .getByRole("option", { name: new RegExp(COMMUNITY_SHEET_FIXTURE_VENUE_NAME) }).first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await option.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(HATTON);
    await expect.poll(() => detailRequested).toBe(true);
    const peek = page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .mobileVenuePeekSummary');
    await expect(peek).toBeVisible({ timeout: 30_000 });
    await expect(peek).toContainText("£4.70");
    await expect(peek).toContainText("current recorded price");
    await expect(peek.locator('[data-pint-trust="confirmed"]')).toBeVisible();
    await expect(peek).not.toContainText(/Checking prices|No price yet|est\./);
    expect(detailSettled).toBe(false);
    releaseRead();
    await expect.poll(() => detailSettled).toBe(true);
    await expect(peek).toContainText("£4.70");
    await expect(peek.locator('[data-pint-trust="confirmed"]')).toBeVisible();
    await expect(peek).not.toContainText("Checking prices");
  } finally {
    releaseRead();
  }
});

const RESELECTED_PRICE_CASES: Array<{
  name: string;
  query: string;
  category: DrinkCategory;
  shown: "category" | "pint" | "unknown";
}> = [
  ...MAP_LENS_DRINK_CATEGORIES.filter((category) => category !== "beer").map((category) => ({
    name: category, query: `drink=${category}`, category, shown: "category" as const,
  })),
  { name: "no-alcohol with alcohol-free", query: "experience=no-alcohol", category: "alcohol-free", shown: "category" },
  { name: "no-alcohol with soft drink", query: "experience=no-alcohol", category: "soft-drink", shown: "category" },
  { name: "missing wine", query: "drink=wine", category: "wine", shown: "unknown" },
  { name: "pint", query: "", category: "wine", shown: "pint" },
];

for (const fixture of RESELECTED_PRICE_CASES) {
  test(`reselected mobile summary preserves ${fixture.name} while pint prices refresh`, async ({ page }) => {
    await installDeterministicMapBasemap(page);
    let targetReads = 0;
    let releaseRead: () => void = () => {};
    const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const submittedAt = Date.now() - DAY_MS;
    const prices = fixture.shown === "unknown" ? [] : [{
      venueId: HATTON, drinkCategory: fixture.category, priceGbp: 6,
      submittedAt, source: "community", corroborations: 2,
    }];
    await page.route("**/api/price-submit**", async (route) => {
      const venueId = new URL(route.request().url()).searchParams.get("venueId");
      await route.fulfill({ json: {
        prices: venueId && venueId !== HATTON ? [] : prices, signals: [], truncated: false,
      } });
    });
    await page.route(`**/api/venue/${HATTON}*`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      await route.fulfill({ json: {
        ...payload,
        venue: {
          ...payload.venue, prices: [], cheapestPrice: null, cheapestPint: "", averagePrice: null,
          sourcedPrice: null, latestContributorPrice: null,
          bundlePrices: { estimate: {
            priceGbp: 6.5, computedAt: new Date(submittedAt).toISOString(),
            basis: "regional_baseline:camden", sampleSize: 8,
          } },
        },
      } });
    });
    await page.route("**/api/pint-drops**", async (route) => {
      const selected = new URL(route.request().url()).searchParams.get("venueId") === HATTON;
      if (selected) targetReads += 1;
      const renewed = selected && targetReads > 1;
      if (renewed) await heldRead;
      await route.fulfill({ json: { drops: renewed ? [row({ priceGbp: 4.7 })] : [] } });
    });
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const peek = sheet.locator(".mobileVenuePeekSummary");
    const expectLensEvidence = async () => {
      await expect(peek).not.toContainText("Checking prices");
      if (fixture.shown === "category") {
        await expect(peek).toContainText("£6.00");
        await expect(peek).toContainText(CATEGORY_META[fixture.category].label);
        await expect(peek).not.toContainText(/£6\.50|£4\.70/);
      } else {
        await expect(peek).toContainText("Unknown");
        await expect(peek).toContainText("no wine price logged");
        await expect(peek).not.toContainText(/£6\.00|£6\.50|£4\.70/);
      }
    };
    const selectThroughSearch = async (name: string, id: string) => {
      await sheet.getByRole("button", { name: /^Close (?:(?:pub|venue) detail|and return to the map)$/ }).click();
      await expect(sheet).toBeHidden();
      await page.getByRole("button", { name: "Search the map", exact: true }).click();
      const search = page.getByRole("combobox", { name: "Search pubs" });
      await expect(search).toBeVisible();
      await search.fill(name);
      const option = page.getByRole("listbox", { name: "Search suggestions" })
        .getByRole("option", { name: new RegExp(name) }).first();
      await expect(option).toBeVisible({ timeout: 30_000 });
      await option.click();
      await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(id);
      await expect(peek).toBeVisible();
    };
    try {
      const initialRead = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/pint-drops" && url.searchParams.get("venueId") === HATTON;
      });
      await page.goto(`/map?sel=${HATTON}&${fixture.query}`);
      await initialRead;
      await expect(peek).toBeVisible({ timeout: 30_000 });
      if (fixture.shown === "pint") await expect(peek).toContainText("£6.50");
      else await expectLensEvidence();
      const otherRead = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/pint-drops" && url.searchParams.get("venueId") === "venue-1vle947";
      });
      await selectThroughSearch("Sir Christopher Hatton", "venue-1vle947");
      await otherRead;
      await selectThroughSearch(COMMUNITY_SHEET_FIXTURE_VENUE_NAME, HATTON);
      await expect.poll(() => targetReads).toBe(2);
      if (fixture.shown === "pint") {
        await expect(peek).toContainText("Checking prices");
        await expect(peek).not.toContainText(/£6\.50|£6\.00|£4\.70/);
      } else await expectLensEvidence();
      const renewedRead = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/pint-drops" && url.searchParams.get("venueId") === HATTON;
      });
      releaseRead();
      await renewedRead;
      if (fixture.shown === "pint") {
        await expect(peek).toContainText("£4.70");
        await expect(peek).not.toContainText(/Checking prices|£6\.50/);
      } else await expectLensEvidence();
    } finally {
      releaseRead();
      // Finish in-flight fixture reads before the context disposes their responses.
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

for (const state of Object.keys(STATES) as StateName[]) {
  test(`${state}: exactly one price door, the composer folded, nothing retired on screen`, async ({
    page,
  }) => {
    const fixture = STATES[state];
    const stub = await installAuthDoubles(page);
    await serveDrops(page, fixture.venueId, fixture.drops);
    await page.goto("/");
    await stub.signedInAs("A");

    await page.goto(`/map?sel=${fixture.venueId}`);
    const sheet = await openVenueSheet(page);
    const doors = sheet.locator("[data-price-door]");
    await expect(doors).toHaveCount(1, { timeout: 30_000 });
    await expect(doors.first()).toHaveAttribute("data-price-door", fixture.door);
    await doors.first().scrollIntoViewIfNeeded();
    await expect(doors.first()).toBeVisible();
    const box = await doors.first().boundingBox();
    expect(box?.height ?? 0, "the door is a thumb target").toBeGreaterThanOrEqual(44);

    // The composer is folded: no form, no Log it, no chips, until the door.
    await expect(sheet.locator(".venuePriceSubmit")).toHaveCount(0);
    for (const retired of RETIRED) {
      await expect(page.getByRole("button", { name: retired }), String(retired)).toHaveCount(0);
    }
    // The sticky bar carries no price action and no painted primary.
    const toolbar = page.locator(".venueSheetStickyBar");
    await expect(toolbar.locator("button", { hasText: /price/i })).toHaveCount(0);
    await expect(toolbar.locator(".venueSheetStickyPrimary")).toHaveCount(0);
  });
}

test("the log door unfolds the composer in place and folds itself away", async ({ page }) => {
  const stub = await installAuthDoubles(page);
  await serveDrops(page, UNPRICED, []);
  await page.goto("/");
  await stub.signedInAs("A");

  await page.goto(`/map?sel=${UNPRICED}`);
  const sheet = await openVenueSheet(page);
  const door = sheet.locator('[data-price-door="log"]');
  await expect(door).toBeVisible({ timeout: 30_000 });
  await expect(door).toHaveText(/Log tonight.s price/);

  const submit = sheet.locator(".venuePriceSubmit");
  await expect(async () => {
    await door.click();
    await expect(submit).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  // The form's own focus effect runs a beat after mount (lib timer plus a
  // frame), and a loaded box can hold that beat for a while.
  await expect(sheet.getByRole("textbox", { name: /Price of a beer at/ })).toBeFocused({
    timeout: 15_000,
  });
  await expect(sheet.locator("[data-price-door]")).toHaveCount(0);
  // The form is now the one price action; the drink-prices invite stays folded.
  await expect(sheet.getByRole("button", { name: /^Log a beer price$/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Log it" })).toHaveCount(1);
});

test("the confirm door still lands on the Pint Drop composer with the figure seeded", async ({
  page,
}) => {
  const stub = await installAuthDoubles(page);
  await serveDrops(page, HATTON, STATES["logged-once"].drops);
  await page.goto("/");
  await stub.signedInAs("B");

  await page.goto(`/map?sel=${HATTON}`);
  const sheet = await openVenueSheet(page);
  const door = sheet.locator('[data-price-door="confirm"]');
  await expect(door).toBeVisible({ timeout: 30_000 });
  await expect(door).toHaveText("Still £4.50?");

  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    await door.click();
    await expect(priceStep).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
  await expect(priceStep.locator("input").first()).toHaveValue("4.50");
});
