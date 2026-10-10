import { expect, test, type Page } from "@playwright/test";

import {
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";
import { installAuthDoubles } from "./helpers/authDoubles";
import { MAP_LENS_DRINK_CATEGORIES } from "@/lib/drinks";

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
    await page.screenshot({ path: test.info().outputPath("price-pending.png") });
    releaseRead();
    await expect(peek).toContainText("£4.70", { timeout: 20_000 });
    await expect(peek).not.toContainText("Checking prices");
    await page.screenshot({ path: test.info().outputPath("price-settled.png") });
  } finally {
    releaseRead();
  }
});

test("a pending pub read never claims an empty drinker price record in Overview", async ({ page }) => {
  let releaseRead!: () => void;
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route("**/api/price-submit**", (route) => route.fulfill({ json: { prices: [], signals: [] } }));
  await page.route("**/api/pint-drops**", async (route) => {
    const selected = new URL(route.request().url()).searchParams.get("venueId") === HATTON;
    if (selected) await heldRead;
    await route.fulfill({ json: { drops: selected ? [row({ priceGbp: 4.7 })] : [] } });
  });
  try {
    await page.goto(`/map?sel=${HATTON}`);
    const sheet = await openVenueSheet(page);
    const inspector = sheet.locator(".venueInspector");
    const pending = inspector.getByRole("status").filter({ hasText: "Checking prices" });
    await expect(pending).toBeVisible();
    await pending.scrollIntoViewIfNeeded();
    const prematureAbsence = await inspector.getByText("No beer price logged by a drinker here yet.", { exact: true }).isVisible();
    await page.screenshot({ path: test.info().outputPath("overview-pending-empty-claim.png") });
    releaseRead();
    await expect(inspector).toContainText("£4.70");
    await expect(inspector.getByText("No beer price logged by a drinker here yet.", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("overview-observed-record.png") });
    expect(prematureAbsence, "An unfinished Pint Drop read cannot establish that no drinker logged a price").toBe(false);
  } finally {
    releaseRead();
  }
});

test("a failed pub price read ends checking and names the unavailable read", async ({ page }) => {
  await page.route("**/api/price-submit**", (route) => route.fulfill({ json: { prices: [], signals: [] } }));
  await page.route("**/api/pint-drops**", (route) => route.fulfill({ status: 503, json: { error: "Fixture unavailable" } }));
  await page.goto(`/map?sel=${UNPRICED}`);
  const sheet = await openVenueSheet(page);
  await expect(sheet.locator(".venueInspector")).toContainText("could not read", { timeout: 20_000 });
  await expect(sheet.locator(".venueInspector")).not.toContainText("Checking prices");
  await expect(sheet.locator(".mobileVenuePeekSummary")).not.toContainText("Checking prices");
  await expect(sheet.locator(".mobileVenuePeekSummary")).toContainText("could not read");
  await expect(sheet.locator(".mobileVenuePeekDrop")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("price-read-unavailable.png") });
  await expect(sheet.locator(".mobileVenuePeekSummary")).not.toContainText(/No price yet|Be the first/);
});

const refreshViews = [
  ...MAP_LENS_DRINK_CATEGORIES.map((category) => ({ category, query: `drink=${category}` })),
  ...(["soft-drink", "alcohol-free"] as const).map((category) => ({
    category,
    query: "experience=no-alcohol",
  })),
  { category: "beer", query: "", failRefresh: true } as const,
];

for (const view of refreshViews) {
  test(`${view.query || "default pint view, unavailable refresh"} (${view.category}): keeps the observed price while reopening a pub`, async ({ page }) => {
    const price = {
      venueId: HATTON,
      drinkCategory: view.category,
      priceGbp: 2.5,
      submittedAt: Date.now(),
      corroborations: 2,
      source: "community",
    };
    await page.route("**/api/price-submit**", (route) => {
      const venueId = new URL(route.request().url()).searchParams.get("venueId");
      return route.fulfill({ json: { prices: venueId && venueId !== HATTON ? [] : [price], signals: [] } });
    });
    let holdRefresh = false;
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const startedRead = new Promise<void>((resolve) => { readStarted = resolve; });
    await page.route("**/api/pint-drops**", async (route) => {
      const selected = new URL(route.request().url()).searchParams.get("venueId") === HATTON;
      if (holdRefresh && selected) {
        readStarted();
        await heldRead;
        if ("failRefresh" in view && view.failRefresh) {
          await route.fulfill({ status: 503, json: { error: "Fixture unavailable" } });
          return;
        }
      }
      await route.fulfill({ json: { drops: selected && view.category === "beer" ? [row({ priceGbp: 2.5 })] : [] } });
    });
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const peek = sheet.locator(".mobileVenuePeekSummary");
    const selectPub = async (name: string, venueId: string) => {
      await sheet.getByRole("button", { name: /^(Close pub detail|Close and return to the map)$/ }).click();
      await expect(sheet).toBeHidden();
      await page.getByRole("button", { name: "Search the map", exact: true }).click();
      const search = page.getByRole("combobox", { name: "Search pubs", exact: true });
      await search.fill(name);
      const option = page.getByRole("listbox", { name: "Search suggestions" })
        .getByRole("group", { name: "Venues", exact: true })
        .getByRole("option", { name: new RegExp(name) }).first();
      await expect(option).toBeVisible({ timeout: 20_000 });
      await option.click();
      await expect(page).toHaveURL((url) => url.searchParams.get("sel") === venueId);
      await expect(sheet).toBeVisible();
    };
    try {
      await page.goto(`/map?${view.query}&sel=${HATTON}`);
      await expect(peek).toContainText("£2.50", { timeout: 30_000 });
      await selectPub("The French House", "venue-1kpe609");
      holdRefresh = true;
      await selectPub(COMMUNITY_SHEET_FIXTURE_VENUE_NAME, HATTON);
      await startedRead;
      await expect(peek).toContainText("£2.50");
      await expect(peek).not.toContainText("Checking prices");
      await page.screenshot({ path: test.info().outputPath("observed-price-refresh.png") });
      const settledRead = page.waitForResponse((response) =>
        new URL(response.url()).searchParams.get("venueId") === HATTON &&
        new URL(response.url()).pathname === "/api/pint-drops");
      releaseRead();
      await settledRead;
      await expect(peek).toContainText("£2.50");
      await expect(peek).not.toContainText("Checking prices");
    } finally {
      releaseRead();
    }
  });
}

test("an absent drink lane stays neutral during a read despite a known pint price", async ({ page }) => {
  await page.route("**/api/price-submit**", (route) => route.fulfill({ json: { prices: [], signals: [] } }));
  let releaseRead!: () => void;
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route("**/api/pint-drops**", async (route) => {
    await heldRead;
    await route.fulfill({ json: { drops: [row({ venueId: LISTED_ONLY, priceGbp: 4.7 })] } });
  });
  try {
    await page.goto(`/map?drink=wine&sel=${LISTED_ONLY}`);
    const peek = page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .mobileVenuePeekSummary');
    await expect(peek).toContainText("Checking prices", { timeout: 30_000 });
    await expect(peek).not.toContainText(/Unknown|£/);
    releaseRead();
    await expect(peek).toContainText("Unknown");
    await expect(peek).not.toContainText(/Checking prices|£/);
  } finally {
    releaseRead();
  }
});

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
