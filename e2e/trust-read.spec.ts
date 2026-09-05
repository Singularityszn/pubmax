import { expect, test, type Page } from "@playwright/test";

// THE TRUST STORY READS ONE WAY, on /map?sel=venue-1vle947 (captain's cut,
// 5 Sept 2026, Fable51Fix section 1).
//
// Production (e8dfd8d, 5 Sept) holds one public Pint Drop at The Sir
// Christopher Hatton: Lager £4.50 by handle `tester`, no authority key, no
// confirmation. That row is the fixture, served here by a route mock in the
// shape /api/pint-drops answers, so the test needs no durable store and no
// clock the server holds.
//
// Three states are driven through the SAME page and the SAME sheet, and for
// each the fence is the regression that may never return: "No price yet" and
// "No beer price logged here yet" while a visible public drop exists. The
// chip is what is asserted, never the confirm action, because the action
// lands in a sibling PR (second-drinker-write) and the two must merge in
// either order: `[data-pint-trust]` is the element that action mounts against.

const VENUE_ID = "venue-1vle947";
const DAY_MS = 24 * 60 * 60 * 1000;
const PROVISIONAL_LINE = "Logged once, needs a second drinker";
const AGED_LINE = "Logged over 30 days ago, needs a fresh drinker";
const ABSENCES = ["No price yet", "No beer price logged here yet", "no beer price logged"];

type DropRow = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number;
  passedDownNote: string;
  era: string;
  provenance: "contributor";
  status: "visible";
  visibility: "public";
  createdAt: string;
  pintPhotoUrl: null;
  venuePhotoUrl: null;
  venueName: string;
  venueMapUrl: string;
  authorityKey?: string;
  confirmation?: {
    confirmationId: string;
    confirmedAt: string;
    basis: "second_reporter";
    confirmingDropId: string;
  } | null;
};

function row(overrides: Partial<DropRow> = {}): DropRow {
  return {
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
    venueName: "The Sir Christopher Hatton",
    venueMapUrl: `/map?sel=${VENUE_ID}`,
    ...overrides,
  };
}

const FIXTURES = {
  "logged-once": () => [row()],
  confirmed: () => {
    const confirmation = {
      confirmationId: "conf-1",
      confirmedAt: new Date(Date.now() - DAY_MS).toISOString(),
      basis: "second_reporter" as const,
      confirmingDropId: "drop-2",
    };
    return [
      row({ confirmation, createdAt: new Date(Date.now() - 2 * DAY_MS).toISOString() }),
      row({
        id: "drop-2",
        handle: "second_drinker",
        authorityKey: "account-second",
        confirmation,
        createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
      }),
    ];
  },
  "aged-out": () => [row({ createdAt: new Date(Date.now() - 90 * DAY_MS).toISOString() })],
} as const;

type TrustState = keyof typeof FIXTURES;

async function serveDrops(page: Page, drops: DropRow[]): Promise<void> {
  await page.route("**/api/pint-drops**", async (route) => {
    const url = new URL(route.request().url());
    const venueId = url.searchParams.get("venueId");
    const body = venueId && venueId !== VENUE_ID ? [] : drops;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: body }),
    });
  });
}

function dismissFirstRunChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
}

const chip = (page: Page, state: TrustState) =>
  page.locator(`.venueInspector [data-pint-trust="${state}"][data-venue-id="${VENUE_ID}"]`);

const EXPECTED_LINE: Record<TrustState, string> = {
  "logged-once": PROVISIONAL_LINE,
  confirmed: "Confirmed",
  "aged-out": AGED_LINE,
};

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await dismissFirstRunChrome(page);
    });

    for (const state of Object.keys(FIXTURES) as TrustState[]) {
      test(`${state}: the chip carries the state and the sheet words no absence`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await serveDrops(page, FIXTURES[state]());

        const response = await page.goto(`/map?sel=${VENUE_ID}`);
        expect(response?.status()).toBe(200);

        const sheet = page.locator(".venueInspector").first();
        await expect(sheet).toBeVisible({ timeout: 60_000 });
        await expect(chip(page, state)).toBeVisible({ timeout: 30_000 });
        await expect(chip(page, state)).toContainText("£4.50");
        await expect(chip(page, state)).toContainText(EXPECTED_LINE[state]);

        // The regression fence. Read the whole sheet, not one row, so a
        // second block wording an absence above or below the chip fails too.
        const text = await sheet.innerText();
        for (const absence of ABSENCES) {
          expect(text.toLowerCase(), absence).not.toContain(absence.toLowerCase());
        }

        if (viewport.name === "phone") {
          // The peek chip a phone shows over the sheet carries the same state.
          const peek = page.locator(`.mobileVenuePeekSummary [data-pint-trust="${state}"]`);
          await expect(peek).toBeVisible({ timeout: 15_000 });
          await expect(peek).toContainText("£4.50");
          await expect(page.locator(".mobileVenuePeekSummary")).not.toContainText("No price yet");
        }
      });
    }
  });
}
