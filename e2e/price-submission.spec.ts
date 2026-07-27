import { expect, test, type Page } from "@playwright/test";

// Community price submission E2E: the word-of-mouth moment end to end on a
// phone - tap a pub, pick a drink, type tonight's price, and watch the venue
// card restamp with its own dated community badge.
//
// TRUST GATE (captain decision 2026-07-26, review findings F1/F4). One device's
// report is NOT the map's price. A browser is one device - same IP, so the same
// server-derived actor - so everything this spec can submit stays at one voice
// however many times it taps. That makes this the natural place to prove the
// uncorroborated half of the policy end to end: the sheet restamps, says it is
// awaiting confirmation, and the map keeps the price on record.
//
// The other two halves are unreachable from a browser and are pinned at their
// seams instead. A genuinely independent second submitter needs two distinct
// actors (__tests__/priceSubmitRoute.test.ts), and a 31-day-old price cannot be
// created at all through the API - submissions are stamped with the server's
// own clock, on purpose - so the age gate is asserted against an injected `now`
// in __tests__/communityPriceSignals.test.ts.
//
// Style mirrors e2e/golden-thread.spec.ts: the non-canvas selection path
// (/map?sel=<venueId>) so no WebGL is required, watchPageErrors, and a stable
// class selector. Unlike that read-only spec this one MUTATES - it POSTs a
// price - which is safe because the keyless e2e run uses the process-memory
// community-price store and never touches the versioned venue dataset.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// A known seed venue id (lib/pintDropSeeds.ts) - the same pub the Golden
// Thread spec drives, so the sheet reliably has content around the card.
const SEED_VENUE_ID = "venue-16pnwmm";
const NO_ALCOHOL_VENUE_ID = "venue-19211ib";
const VIEWPORT = { width: 390, height: 844 };

test.setTimeout(60_000);

// The restamp test below asserts a sub-second wall-clock budget. Run this
// file's tests sequentially in one worker (opting out of fullyParallel) so the
// sibling test's own first-hit POSTs don't contend with the timed submission
// on the shared single-process server and contaminate the measurement.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a drinker logs tonight's price and the card restamps, dated and badged", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  await expect(venueSheet.locator(".venueInspector")).toBeVisible();

  // The submit card lives on the Overview tab, the tab the sheet opens on.
  const submit = venueSheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();
  // The copy uses a typographic apostrophe, so match the shape, not the glyph.
  await expect(submit.getByRole("heading", { name: /What.s it tonight\?/ })).toBeVisible();

  // Every control is thumb-sized at 390px - this is a card used one-handed at
  // a bar, so a cramped target is a real defect, not a nit.
  for (const name of ["Beer", "Alcohol-free", "Soft drinks", "Wine"]) {
    const chip = submit.getByRole("radio", { name, exact: true });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box?.height ?? 0, `${name} chip height`).toBeGreaterThanOrEqual(44);
  }
  const quickPriceChips = submit.locator(".vpsubQuickChip");
  await expect(quickPriceChips).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const chip = quickPriceChips.nth(index);
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box?.height ?? 0, `quick-price chip ${index + 1} height`).toBeGreaterThanOrEqual(44);
  }

  const priceField = submit.getByRole("textbox");
  const logButton = submit.getByRole("button", { name: "Log it" });

  // Bounds first: an implausible figure is refused in place, with a sentence
  // that says what a real price looks like - and nothing reaches the map.
  await priceField.fill("0.45");
  await logButton.click();
  const error = submit.getByRole("alert");
  await expect(error).toBeVisible();
  await expect(error).toContainText("£4.50");
  await expect(venueSheet.locator(".communityPriceRow")).toHaveCount(0);

  // Warm /api/price-submit before starting the clock: the server's first hit
  // to this route after boot pays one-off module-load cost that has nothing to
  // do with the restamp being timed below. The GET warms the read path; the
  // discarded POST (to a DIFFERENT seed venue, so this venue's sheet and rate
  // limit are untouched) warms the full write path - validator, actor hashing,
  // rate-limit plumbing, store write. This is not redundant setup - it exists
  // so the sub-second budget measures the product moment (tap to restamp on a
  // warm path), not server cold start. Do not delete.
  const warmupRead = await page.request.get(`/api/price-submit?venueId=${SEED_VENUE_ID}`);
  expect(warmupRead.status()).toBe(200);
  const warmupWrite = await page.request.post("/api/price-submit", {
    data: { venueId: "venue-ekvkuv", drinkCategory: "beer", priceGbp: 4.0 },
  });
  expect(warmupWrite.status()).toBe(201);

  // Now a real price. The restamp must land within a second - this is the
  // whole product moment, not a background sync. Wall-clock on a shared box is
  // noisy: a CPU-starved host can stretch ANY interaction past a second no
  // matter how fast the product is, so the MEASUREMENT retries while the
  // CRITERION stays hard. Up to three timed submissions, each with a fresh
  // price so the restamp for that specific tap is unambiguous; one sub-second
  // landing proves the moment, and a genuine regression past a second fails
  // all three attempts and the test still fails loudly.
  const stamp = submit.locator(".vpsubStamp");
  const attemptsMs: number[] = [];
  let landedPrice = "";
  for (const pounds of ["4.20", "4.30", "4.40"]) {
    await priceField.fill(pounds);
    const submittedAt = Date.now();
    await logButton.click();
    // The restamp for THIS tap is the stamp carrying this attempt's price.
    await expect(stamp).toContainText(`£${pounds}`, { timeout: 5_000 });
    const elapsed = Date.now() - submittedAt;
    attemptsMs.push(elapsed);
    landedPrice = pounds;
    if (elapsed < 1_000) break;
  }
  expect(
    attemptsMs.some((ms) => ms < 1_000),
    `the restamp should appear within a second of the tap (attempts: ${attemptsMs.join("ms, ")}ms)`,
  ).toBe(true);
  await expect(stamp).toBeVisible();
  await expect(stamp).toContainText(`£${landedPrice}`);
  await expect(stamp).toContainText("today");

  // …and the receipt is honest about REACH. One device is one voice, so this
  // tap has MARKED the map - the provisional badge on the pin - without setting
  // any price on it. Both halves matter: "Marked on the map" is the loop
  // closing in-session (captain decision 2026-07-26), and the hint beside it is
  // what stops that reading as "the pin now says £4.40".
  await expect(stamp).toContainText("Marked on the map");
  const stampHint = submit.locator(".vpsubStampHint");
  await expect(stampHint).toBeVisible();
  await expect(stampHint).toContainText(/second drinker/i);

  // The venue card carries the same price on its own dated, badged row -
  // alongside the price on record, which is still shown.
  const communityRow = venueSheet.locator(".communityPriceRow");
  await expect(communityRow).toBeVisible();
  await expect(communityRow).toContainText(`£${landedPrice}`);
  await expect(communityRow).toContainText("today");

  // The uncorroborated half of the policy, as the reader meets it: the figure
  // shows in full, dated, and says where it stands rather than letting the
  // reader assume a pin moved with it.
  await expect(communityRow.locator(".communityPriceStanding")).toContainText(
    /marked on the map as unconfirmed/i,
  );

  // And the number the map gate actually reads. Every submission in this test
  // came from one browser - one IP, so one server-derived actor - so however
  // many times it tapped, the venue still has exactly one voice behind it and
  // mergeCommunityPriceSignals refuses to restamp. The pin itself is a WebGL
  // surface this spec deliberately never opens, so the restamp decision is
  // asserted at its seam instead (__tests__/communityPriceSignals.test.ts);
  // what belongs here is proving the browser really did reach that state.
  const record = await page.request.get(`/api/price-submit?venueId=${SEED_VENUE_ID}`);
  expect(record.status()).toBe(200);
  const { prices } = (await record.json()) as {
    prices: Array<{ drinkCategory: string; priceGbp: number; corroborations?: number }>;
  };
  const beer = prices.find((row) => row.drinkCategory === "beer");
  expect(beer?.priceGbp, "the submitted price is on record").toBe(Number(landedPrice));
  expect(
    beer?.corroborations,
    "one device cannot corroborate itself, however many times it logs",
  ).toBe(1);

  // Provenance is not flattened: whatever the pub had before the submission -
  // a sourced/baseline price row, or the honest "no price yet" nudge - is still
  // there underneath the new community row, not overwritten by it.
  await expect
    .poll(
      async () =>
        (await venueSheet.locator(".contributorPrice:not(.communityPriceRow)").count()) +
        (await venueSheet.locator(".firstDropNudge").count()),
      { message: "the price on record should survive a community submission" },
    )
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("a person can log soft-drink and alcohol-free prices from the pub sheet", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const response = await page.goto(`/map?sel=${NO_ALCOHOL_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const submit = venueSheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();
  const priceField = submit.getByRole("textbox");
  const logButton = submit.getByRole("button", { name: "Log it" });
  const stamp = submit.locator(".vpsubStamp");

  for (const entry of [
    { label: "Soft drinks", category: "soft-drink", price: "2.80" },
    { label: "Alcohol-free", category: "alcohol-free", price: "4.60" },
  ] as const) {
    const category = submit.getByRole("radio", {
      name: entry.label,
      exact: true,
    });
    await category.click();
    await expect(category).toHaveAttribute("aria-checked", "true");
    await priceField.fill(entry.price);
    await logButton.click();
    await expect(stamp).toContainText(`£${entry.price}`);
    await expect(stamp).toContainText("On this pub’s page");

    const record = await page.request.get(
      `/api/price-submit?venueId=${NO_ALCOHOL_VENUE_ID}`,
    );
    expect(record.status()).toBe(200);
    const { prices } = (await record.json()) as {
      prices: Array<{ drinkCategory: string; priceGbp: number }>;
    };
    expect(
      prices.find((row) => row.drinkCategory === entry.category)?.priceGbp,
    ).toBe(Number(entry.price));
  }

  const communityRow = venueSheet.locator(".communityPriceRow");
  await expect(communityRow).toContainText("Alcohol-free");
  await expect(communityRow).toContainText("£4.60");
  expect(errors).toEqual([]);
});

test("the one-tap price confirm still works alongside submission", async ({ page }) => {
  const errors = watchPageErrors(page);

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();

  // The Golden Thread (and its "Still £X?" chip) lives on the Stories tab.
  await venueSheet.getByRole("tab", { name: "Stories", exact: true }).click();
  const priceStory = page.locator(".venuePriceStory");
  await expect(priceStory).toHaveCount(1);

  // This seed pub carries a resolvable price, so the vouch chip is present and
  // asserted outright - if a seed change ever removed it, this regression guard
  // should fail loudly rather than quietly assert nothing.
  const confirmChip = priceStory.locator(".vpsConfirmBtn");
  await expect(confirmChip).toBeVisible();
  await expect(confirmChip).toHaveAttribute("aria-pressed", "false");
  await confirmChip.click();
  await expect(confirmChip).toHaveAttribute("aria-pressed", "true");
  await expect(confirmChip).toContainText("Confirmed");

  expect(errors).toEqual([]);
});
