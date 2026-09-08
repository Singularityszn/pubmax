import { test, expect, type Page } from "@playwright/test";
import { attachSpillBill, installPriceUploadCapture } from "./helpers/priceBill";

// Keyless prices require a verified account. An unpriced note keeps the demo path.
// Both requests reach the real keyless route and store. No POST response is stubbed.

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

test("keyless composer retains a refused price draft and saves an unpriced note", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const readUpload = await installPriceUploadCapture(page, "/api/pint-drops");
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
  await venueSheet.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(pintsPanel).toBeVisible();
  await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();
  const form = page.locator("form.dropComposer");
  await expect(form).toBeVisible();

  const story = `codex mobile submit ${Date.now()}`;
  const handle = `codex_mobile_${Date.now()}`;

  // The fast path first: handle, price, drink are all in the compact door.
  await form.getByLabel("Handle").fill(`@${handle}`);
  await form.getByRole("group", { name: /quick-add price/i }).getByRole("button").first().click();
  await form.getByLabel("Drink").fill("Codex test pint");

  // The story is optional, behind the disclosure.
  await form.getByRole("button", { name: "Add a photo or story" }).click();
  await form.getByLabel("Story").fill(story);

  await attachSpillBill(form);
  const refusedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/pint-drops") && response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Log it" }).click();
  const refused = await refusedResponse;
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toMatchObject({
    error: "Sign in to post a price under your name.", code: "UNAUTHENTICATED",
  });
  const submitted = await readUpload(refused.request());
  expect(submitted).toMatchObject({
    venueId: ARNOS_ARMS_ID, handle: `@${handle}`, drink: "Codex test pint", measure: "pint", priceGbp: "4.00",
  });
  await expect(form.getByRole("alert")).toHaveText("Sign in to post a price under your name.");
  await expect(form.getByLabel("What did it cost?")).toHaveValue("4.00");
  await expect(form.getByLabel("Story")).toHaveValue(story);
  await expect(form.getByRole("img", { name: "Preview of the bill behind your price" })).toBeVisible();
  await expect(pintsPanel.locator("article.dropCard").filter({ hasText: story })).toHaveCount(0);

  // Removing the price changes the intent. The note still reaches the real store.
  await form.getByLabel("What did it cost?").fill("");
  const savedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/pint-drops") && response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Log it" }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  const { drop } = await saved.json();
  expect(drop).toMatchObject({
    venueId: ARNOS_ARMS_ID, handle, priceGbp: null, passedDownNote: story,
  });
  await expect(form).toHaveCount(0);
  await expect(pintsPanel).toContainText(story);

  expect(errors).toEqual([]);
});
