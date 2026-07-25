import { expect, test, type Page } from "@playwright/test";

// Community price submission E2E: the word-of-mouth moment end to end on a
// phone - tap a pub, pick a drink, type tonight's price, and watch the venue
// card restamp with its own dated community badge.
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
const VIEWPORT = { width: 390, height: 844 };

test.setTimeout(60_000);

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
  for (const name of ["Beer", "Wine"]) {
    const chip = submit.getByRole("radio", { name, exact: true });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box?.height ?? 0, `${name} chip height`).toBeGreaterThanOrEqual(36);
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
  // do with the restamp being timed below. This is not redundant setup - it
  // exists so the sub-second budget measures the product moment (tap to
  // restamp on a warm path), not server cold start. Do not delete.
  const warmup = await page.request.get(`/api/price-submit?venueId=${SEED_VENUE_ID}`);
  expect(warmup.status()).toBe(200);

  // Now a real price. The restamp must land within a second - this is the
  // whole product moment, not a background sync.
  await priceField.fill("4.20");
  const submittedAt = Date.now();
  await logButton.click();

  const stamp = submit.locator(".vpsubStamp");
  await expect(stamp).toBeVisible({ timeout: 1_000 });
  expect(
    Date.now() - submittedAt,
    "the restamp should appear within a second of the tap",
  ).toBeLessThan(1_000);
  await expect(stamp).toContainText("£4.20");
  await expect(stamp).toContainText("today");

  // The venue card carries the same price on its own dated, badged row -
  // alongside the price on record, which is still shown.
  const communityRow = venueSheet.locator(".communityPriceRow");
  await expect(communityRow).toBeVisible();
  await expect(communityRow).toContainText("£4.20");
  await expect(communityRow).toContainText("today");

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
