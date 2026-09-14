import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { attachBill, readPriceSubmission } from "./helpers/priceBill";

/**
 * ONE RULE (captain, 5 Sep 2026), the whole way through on a phone. A new
 * member claims a handle with NO date of birth, meets the age door on the
 * price they typed, taps once, and the price lands.
 *
 * The claim card used to hold `Claim handle` disabled until a birth date was
 * typed, and `PATCH /api/identity/onboarding` refused a blank one, so the
 * account state the recorded adult tap was written for could not be reached
 * from the product at all. This spec walks that state.
 *
 * The keyless e2e server verifies no bearer, so the identity and price writes
 * are answered by route doubles in the shape the server answers
 * (`__tests__/identityOnboardingRoute` and `__tests__/contributionAgeAnswer`
 * pin the server's own reading). What is proved here is the browser half.
 */

const VENUE_ID = "venue-16pnwmm";
const AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const HANDLE = "undated_owl";
const SHOT_DIR = resolve(
  process.cwd(),
  "docs/proof/one-rule-claim-card",
  process.env.PW_PROOF_LANE ?? "after",
);
const SHOOTING = process.env.PW_PROOF_SHOTS === "1";
const SHOT_SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
] as const;

test.use({ viewport: { width: 390, height: 844 } });

type Boundary = {
  /** Every body `POST /api/identity/onboarding` was sent, in order. */
  claims: Array<Record<string, unknown>>;
  /** Every body `POST /api/price-submit` was sent, refusals included. */
  prices: Array<Record<string, unknown>>;
};

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId }) => {
      window.localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          access_token: "pubmaxx-e2e-access-token",
          refresh_token: "pubmaxx-e2e-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
          expires_in: 86_400,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "undated-e2e@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-09-05T00:00:00.000Z",
          },
        }),
      );
    },
    { authStorageKey: AUTH_STORAGE_KEY, userId: AUTH_USER_ID },
  );
}

/**
 * The account this spec walks: signed in, no handle, no date of birth and no
 * recorded tap. `claimed` and `tapped` move as the browser really writes them,
 * so every later read answers what the server would answer next.
 */
async function installUndatedBoundary(page: Page): Promise<Boundary> {
  await seedSignedInSession(page);
  const boundary: Boundary = { claims: [], prices: [] };
  let claimed = false;
  let tapped = false;

  await page.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "undated-e2e@example.test",
      }),
    }),
  );
  await page.route("**/api/identity/onboarding", async (route) => {
    if (route.request().method() === "POST") {
      boundary.claims.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      claimed = true;
      // The server's own answer to a claim carrying no date of birth: the
      // handle is claimed, and `complete` reports the row it did not write.
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ complete: false, handle: HANDLE }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        claimed ? { complete: false, handle: HANDLE } : { complete: false },
      ),
    });
  });
  await page.route("**/api/identity/handle/availability?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true }),
    }),
  );
  await page.route("**/api/identity/handle/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: claimed ? HANDLE : null }),
    }),
  );
  await page.route("**/api/identity/adult-assertion**", (route) => {
    tapped = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assertedAt: new Date().toISOString() }),
    });
  });
  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prices: [], signals: [] }),
      });
      return;
    }
    const body = readPriceSubmission(route.request()) as Record<string, unknown>;
    boundary.prices.push(body);
    if (!tapped) {
      // The gate asks for the age answer alone, and never for a birth date.
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          status: "adult_check_required",
          code: "ADULT_CHECK_REQUIRED",
          error: "Confirm you are 18 or over before contributing.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        attribution: { status: "credited", handle: HANDLE },
        price: {
          id: "price-e2e-1",
          venueId: body.venueId,
          drinkCategory: body.drinkCategory,
          priceGbp: body.priceGbp,
          submittedAt: Date.now(),
          source: "community",
          corroborations: 1,
        },
      }),
    });
  });
  return boundary;
}

function claimCard(page: Page): Locator {
  return page.getByRole("dialog", { name: "Let's get you in" });
}

async function claimWithNoBirthDate(page: Page): Promise<Locator> {
  const card = claimCard(page);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByLabel("Your handle").fill(HANDLE);
  await expect(card.getByRole("status")).toHaveText("Handle available.");
  return card;
}

async function openVenueSheet(page: Page): Promise<Locator> {
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const inspector = sheet.locator(".venueInspector");
  const expand = sheet.getByRole("button", { name: "Expand sheet" });
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()), {
      timeout: 30_000,
    })
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) {
    await expand.click();
  }
  await expect(inspector).toBeVisible();
  return sheet;
}

/** Type tonight's price and send it, retrying the door's first tap. */
async function typeAndLog(sheet: Locator, price: string): Promise<void> {
  const door = sheet.locator('[data-price-door="log"]');
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(async () => {
    await door.click();
    await expect(submit).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await submit.getByRole("textbox").fill(price);
  await attachBill(submit);
  await submit.getByRole("button", { name: "Log it" }).click();
}

test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

test("the claim card calls a date of birth optional and claims without one", async ({
  page,
}) => {
  const boundary = await installUndatedBoundary(page);
  await page.goto("/today");
  const card = await claimWithNoBirthDate(page);

  // Two optional fields, said in the same words, and no browser-side demand
  // for the date either.
  await expect(card.getByText("Name Optional", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Date of birth Optional", { exact: true }),
  ).toBeVisible();
  const dateField = card.getByLabel("Date of birth");
  await expect(dateField).toHaveValue("");
  await expect(dateField).not.toHaveAttribute("required", /.*/);

  const claim = card.getByRole("button", { name: "Claim handle" });
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });

  // The blank field is left OUT of the claim rather than sent empty.
  expect(boundary.claims).toEqual([{ handle: HANDLE }]);
});

test("a member with no birth date reaches their first price on one tap", async ({
  page,
}) => {
  const boundary = await installUndatedBoundary(page);
  await page.goto("/today");
  const card = await claimWithNoBirthDate(page);
  await card.getByRole("button", { name: "Claim handle" }).click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });

  await page.goto(`/map?sel=${VENUE_ID}`);
  const sheet = await openVenueSheet(page);
  await typeAndLog(sheet, "4.40");

  const gate = page.locator(".contributionGate");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  await expect(gate.getByRole("heading")).toHaveText("Confirm your age");
  // The door that stands between a new member and their first price asks for
  // one tap, and asks nothing about a birth date.
  await expect(gate).not.toContainText(/date of birth/i);
  await expect(gate.locator('input[type="date"]')).toHaveCount(0);
  await gate.getByRole("button", { name: /18 or over/ }).click();

  await expect(gate).toHaveCount(0, { timeout: 20_000 });
  await expect(sheet.locator(".vpsubStampPrice").first()).toHaveText("£4.40", {
    timeout: 20_000,
  });
  // The resumed write is the SAME price, never one the drinker retyped.
  expect(boundary.prices.map((body) => body.priceGbp)).toEqual([4.4, 4.4]);
});

test("the claim card is one readable card at every width", async ({ page }) => {
  test.skip(!SHOOTING, "Proof shots only: run with PW_PROOF_SHOTS=1.");
  mkdirSync(SHOT_DIR, { recursive: true });
  await installUndatedBoundary(page);
  for (const size of SHOT_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/today");
    await claimWithNoBirthDate(page);
    await page.screenshot({ path: `${SHOT_DIR}/claim-card-${size.name}.png` });
  }
});
