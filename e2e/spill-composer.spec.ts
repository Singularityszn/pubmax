import { test, expect, type Page } from "@playwright/test";

// Camera-first Spill composer E2E (PRD "For-You map" priority 2). WebGL-agnostic:
// the composer is a DOM panel inside VenueInspector, opened by deep-linking to a
// seed pub's detail sheet (?sel=<id>) and clicking the sticky "Log a Pint Drop"
// button — never a canvas pin click. Mirrors e2e/social-loop.spec.ts / e2e/
// map-story.spec.ts: watchPageErrors, web-first assertions, .count()-guards so an
// empty/altered seed is never a hard failure, no waitForTimeout.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey (the same tiny,
// stable, public hash e2e/map-story.spec.ts + smoke.spec.ts use) so we can
// deep-link straight to a known seed pub's detail sheet without a canvas click.
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

// A known seed row from public/data/pint_prices_app_dataset.json ("Arnos Arms")
// — the same stable id map-story.spec.ts deep-links to.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.1335).toFixed(5),
  ].join("|"),
);

// Open the composer inside the Pints panel and return the panel + form locators.
async function openComposer(page: Page) {
  await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  const pintsPanel = page.locator("#venuePanel-pints");
  await expect(pintsPanel).toBeVisible();
  await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();
  const form = page.locator("form.dropComposer");
  await expect(form).toBeVisible();
  return { pintsPanel, form };
}

test.describe("camera-first Spill composer", () => {
  test("on a 390px viewport the camera step is presented FIRST", async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);

    // The camera step renders, and it is the FIRST child of the form (camera-first).
    const cameraStep = form.locator('[data-testid="spill-camera-step"]');
    await expect(cameraStep).toBeVisible();

    const firstChildIsCamera = await form.evaluate((el) => {
      const first = el.firstElementChild;
      return first?.getAttribute("data-testid") === "spill-camera-step";
    });
    expect(firstChildIsCamera).toBe(true);

    // Camera-first means the price/text fields are NOT shown until the photo step
    // is resolved: the "Skip photo" affordance is present, and the price field is
    // gated away behind it.
    await expect(cameraStep.getByRole("button", { name: /skip photo/i })).toBeVisible();
    await expect(page.getByRole("group", { name: /quick-add price/i })).toHaveCount(0);

    // Tapping "skip photo" reveals the rest of the composer (price + destinations).
    await cameraStep.getByRole("button", { name: /skip photo/i }).click();
    await expect(page.getByRole("group", { name: /quick-add price/i })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("one-tap destination + price chips render, and preview updates on price", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);

    // Get past the camera-first step into the full form.
    await form.getByRole("button", { name: /skip photo/i }).click();

    // Destination chips (Tonight / My Round / Family Table / Ledger) render.
    const destinations = form.getByRole("group", { name: /add this spill to/i });
    await expect(destinations).toBeVisible();
    for (const label of ["Tonight", "My Round", "Family Table", "Ledger"]) {
      await expect(destinations.getByRole("button", { name: label })).toBeVisible();
    }
    // My Round is honestly disabled with no open Round (never faked).
    await expect(destinations.getByRole("button", { name: "My Round" })).toBeDisabled();

    // Price quick-add chips render.
    const priceChips = form.getByRole("group", { name: /quick-add price/i });
    await expect(priceChips).toBeVisible();
    await expect(priceChips.getByRole("button").first()).toBeVisible();

    // Instant preview: no price stamp yet, then a price chip tap makes one appear.
    await expect(form.locator(".spillPreviewPrice")).toHaveCount(0);
    await priceChips.getByRole("button").first().click();
    await expect(form.locator(".spillPreviewPrice")).toBeVisible();
    await expect(form.locator(".spillPreviewPrice")).toContainText(/£/);

    // A priced Spill reads as a Contributor claim in the live preview — provenance
    // surfaced, never flattened.
    await expect(form.locator(".spillPreviewProv")).toContainText(/Contributor/i);

    expect(errors).toEqual([]);
  });

  test("choosing Family Table selects the Legacy visibility lane", async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);
    await form.getByRole("button", { name: /skip photo/i }).click();

    await form.getByRole("button", { name: "Family Table" }).click();

    // The (secondary) visibility radiogroup should now have Legacy checked.
    const visibility = form.getByRole("radiogroup", { name: "Visibility" });
    await expect(visibility.getByRole("radio", { name: "Legacy" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    expect(errors).toEqual([]);
  });

  test("large-text / Legacy Mode keeps the composer usable at 390px", async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // Legacy Mode is a data attribute on <html>; set it before the composer opens.
    await page.addInitScript(() => document.documentElement.setAttribute("data-legacy", "1"));

    const { form } = await openComposer(page);
    await form.getByRole("button", { name: /skip photo/i }).click();

    // The core controls still render and are operable under Legacy Mode.
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();
    await expect(form.getByRole("button", { name: "Tonight" })).toBeVisible();
    await expect(form.locator(".spillPreviewCard")).toBeVisible();

    expect(errors).toEqual([]);
  });
});
