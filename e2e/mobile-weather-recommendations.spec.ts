import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Authoring a weather Recommendation on a phone, in the dark, one-handed.
//
// The card is a WRITE surface on the venue sheet, so the browser evidence has
// to be the real thing: a real venue sheet, the real POST, and the real reread
// that puts the saved opinion back under the author's handle. The matched-
// weather reading is a second test because the committed snapshot the keyless
// build falls back to is long expired, so the honest live answer here is
// "we couldn't check the weather" - that half is stubbed at the route so the
// "Fits tonight" wording is exercised rather than assumed.

const VIEWPORT = { width: 390, height: 844 };
const ARNOS_ARMS_ID = "venue-xjf3n0";
// Design-QA captures are opt-in, same deal as PW_SCREENSHOTS: an assertion run
// should not litter a working tree.
const SHOTS_DIR = process.env.WEATHER_REC_SHOTS_DIR ?? "";

test.setTimeout(120_000);

// The sheet keeps growing under the card while the rest of the venue loads, so
// the framing scroll belongs immediately before the capture, not before the
// assertions that ran in between.
async function shot(page: Page, basename: string, focus: Locator): Promise<void> {
  if (!SHOTS_DIR) return;
  await focus.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "instant" });
  });
  const png = await page.screenshot({ fullPage: false });
  await mkdir(SHOTS_DIR, { recursive: true });
  await writeFile(`${SHOTS_DIR}/${basename}.png`, png);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "dark");
    document.documentElement.dataset.theme = "dark";
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function openVenueCard(page: Page): Promise<Locator> {
  // The map keeps streaming tiles long after the sheet is usable, so waiting
  // for `load` would time the sheet out rather than measure it.
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  const card = page.locator(".venueWeatherRecommendations");
  await expect(card).toBeAttached({ timeout: 60_000 });
  await card.evaluate((element) => {
    element.scrollIntoView({ block: "start", behavior: "instant" });
  });
  await expect(card).toBeVisible();
  return card;
}

async function expectThumbReachable(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should be laid out`).not.toBeNull();
  expect(box!.height, `${label} should clear the 44px tap floor`).toBeGreaterThanOrEqual(44);
  expect(box!.x, `${label} should not sit off the left edge`).toBeGreaterThanOrEqual(0);
  expect(
    box!.x + box!.width,
    `${label} should not sit off the right edge`,
  ).toBeLessThanOrEqual(VIEWPORT.width);
}

test("a Pubmaxxer authors a weather recommendation one-handed in dark mode at 390px", async ({
  page,
}) => {
  const card = await openVenueCard(page);
  await expect(card.getByRole("heading", { name: "Recommend it for the weather" })).toBeVisible();

  // Dark mode is the shipped theme here, not an emulated preference only.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const conditions = card.getByRole("radiogroup", { name: /When does Arnos Arms suit\?/ });
  await expect(conditions).toBeVisible();
  await expect(conditions.getByRole("radio")).toHaveCount(5);
  for (const label of ["Warm", "Clear skies", "Raining", "Cold", "Windy"]) {
    await expectThumbReachable(
      conditions.locator("label", { hasText: new RegExp(`^${label}$`) }).first(),
      `${label} chip`,
    );
  }

  await shot(page, "weather-recommendations-390-dark-before", conditions);

  const handle = card.getByLabel("Your Pubmaxx handle");
  const reason = card.getByLabel("Why Arnos Arms suits this weather");
  const submit = card.getByRole("button", { name: "Recommend it" });
  await expectThumbReachable(handle, "handle field");
  await expectThumbReachable(reason, "reason field");
  await expectThumbReachable(submit, "Recommend it button");

  // Nothing is submittable until the drinker has said who they are and why.
  await expect(submit).toBeDisabled();

  // The radio itself is screen-reader only: a thumb lands on the chip.
  await conditions.locator("label", { hasText: /^Raining$/ }).first().click();
  await expect(conditions.getByRole("radio", { name: "Raining" })).toBeChecked();
  await handle.fill("rainy_ren");
  await reason.fill("Proper fire in the back room and the roof never drips.");
  await expect(submit).toBeEnabled();
  await submit.click();

  const saved = card.getByRole("status");
  await expect(saved).toContainText("Saved under @rainy_ren for raining weather.");

  // The reread puts it back as somebody's opinion, attributed and dated.
  const opinion = card.locator(".weatherRecOpinion", { hasText: "rainy_ren" });
  await expect(opinion).toBeVisible();
  await expect(opinion).toContainText("recommends this when it’s raining.");
  await expect(opinion).toContainText("Proper fire in the back room and the roof never drips.");
  await expect(opinion.locator(".weatherRecDate")).toContainText("Recommended ");
  await expect(opinion.getByRole("link", { name: "@rainy_ren" })).toHaveAttribute(
    "href",
    "/u/rainy_ren",
  );

  // It is an opinion, and the card says so beside the form that took it.
  await expect(card.locator(".weatherRecHonesty")).toHaveText(
    "This is your opinion, shown under your handle. Weather only decides when it appears as a match.",
  );

  // No score, no rank, no rating anywhere on the surface.
  const cardText = (await card.innerText()).toLowerCase();
  for (const banned of ["score", "rank", "rating", "out of 5", "stars"]) {
    expect(cardText, `the card must not read as a review (${banned})`).not.toContain(banned);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the card must not widen the phone viewport").toBeLessThanOrEqual(1);

  await shot(page, "weather-recommendations-390-dark-saved-receipt", saved);
  await shot(page, "weather-recommendations-390-dark-saved-opinion", opinion);
});

test("a checkable snapshot surfaces only the matching opinion, and an uncheckable one says so", async ({
  page,
}) => {
  const rows = [
    {
      id: "rec-rain",
      venueId: ARNOS_ARMS_ID,
      condition: "raining",
      reason: "Proper fire in the back room and the roof never drips.",
      contributorHandle: "rainy_ren",
      submittedAt: Date.UTC(2026, 6, 20, 19, 30),
      source: "community",
    },
    {
      id: "rec-warm",
      venueId: ARNOS_ARMS_ID,
      condition: "warm",
      reason: "Beer garden gets the late sun until nine.",
      contributorHandle: "sunny_sam",
      submittedAt: Date.UTC(2026, 6, 21, 18, 0),
      source: "community",
    },
  ];

  let weatherCheckable = true;
  await page.route("**/api/weather-recommendations?venueId=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        weatherCheckable
          ? {
              weatherStatus: "available",
              matchingConditions: ["raining"],
              recommendations: rows.filter((row) => row.condition === "raining"),
              degraded: false,
              truncated: false,
            }
          : {
              weatherStatus: "unavailable",
              matchingConditions: [],
              recommendations: rows,
              degraded: false,
              truncated: false,
            },
      ),
    });
  });

  const card = await openVenueCard(page);
  await expect(card.getByRole("heading", { level: 4, name: "Fits tonight" })).toBeVisible();
  await expect(card.locator(".weatherRecOpinion")).toHaveCount(1);
  await expect(card.locator(".weatherRecOpinion")).toContainText(
    "recommends this when it’s raining.",
  );
  await shot(
    page,
    "weather-recommendations-390-dark-matched",
    card.locator(".weatherRecListTitle"),
  );

  weatherCheckable = false;
  const unmatched = await openVenueCard(page);
  await expect(unmatched.getByRole("note")).toContainText(
    "We couldn’t check the weather here just now. These are Pubmaxxers’ recommendations, shown without a weather match.",
  );
  // Unconditional, not empty: both authored opinions still show.
  await expect(unmatched.getByRole("heading", { level: 4, name: "Pubmaxxers recommend" })).toBeVisible();
  await expect(unmatched.locator(".weatherRecOpinion")).toHaveCount(2);
  await shot(
    page,
    "weather-recommendations-390-dark-weather-unavailable",
    unmatched.getByRole("note"),
  );
});
