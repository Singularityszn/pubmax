import { test, expect, type Page } from "@playwright/test";
import { attachSpillBill } from "./helpers/priceBill";

// The keyless composer accepts a demo handle for drafting, but a price still
// requires a verified account. An optimistic story is not a saved Pint Drop.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey (the same tiny,
// stable, public hash e2e/spill-composer.spec.ts uses).
function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test("keyless mobile priced submit refuses an unverified handle without saving", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const pintsPanel = venueSheet.locator("#venuePanel-pints");
  await venueSheet.getByRole("tab", { name: "Prices", exact: true }).click();
  await expect(pintsPanel).toBeVisible();
  await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();
  const form = page.locator("form.dropComposer");
  await expect(form).toBeVisible();

  const story = `codex mobile submit ${Date.now()}`;
  const handle = `codex_mobile_${Date.now()}`;

  // The fast path first: handle, price, drink are all in the compact door.
  await form.getByLabel("Handle").fill(`@${handle}`);
  await form.getByRole("group", { name: /quick-add price/i }).getByRole("button").first().click();
  await form.getByRole("textbox", { name: "Drink", exact: true }).fill("Codex test pint");

  // The story is optional, behind the disclosure.
  await form.getByRole("button", { name: "Add a photo or story" }).click();
  await form.getByLabel("Story").fill(story);

  await attachSpillBill(form);
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/pint-drops" &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Log it" }).click();
  const response = await submitted;
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });

  await expect(form).toHaveCount(0);
  const attemptedDrop = pintsPanel.getByRole("article").filter({ hasText: story });
  await expect(attemptedDrop.getByRole("alert")).toContainText("Not saved");

  const persisted = await page.request.get(`/api/pint-drops?venueId=${ARNOS_ARMS_ID}`);
  expect(persisted.ok()).toBe(true);
  const { drops } = await persisted.json();
  expect(drops).toEqual(expect.any(Array));
  expect(drops).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ passedDownNote: story })]),
  );

  expect(errors).toEqual([]);
});
