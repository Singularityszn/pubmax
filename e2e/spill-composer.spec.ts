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

// A known seed row from public/data/venues_slim.json ("Arnos Arms") — the same
// stable id smoke.spec.ts deep-links to.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
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
  test("on a 390px viewport the camera action leads without blocking price fields", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);

    // Venue context leads, then the compact camera action. Price/story controls
    // are still visible without a mandatory camera skip.
    const cameraStep = form.locator('[data-testid="spill-camera-step"]');
    await expect(form.locator(".spillComposerIntro")).toContainText("Arnos Arms");
    await expect(cameraStep).toBeVisible();

    const firstChildrenAreIntroThenCamera = await form.evaluate((el) => {
      const children = Array.from(el.children).slice(0, 2);
      return (
        children[0]?.classList.contains("spillComposerIntro") === true &&
        children[1]?.getAttribute("data-testid") === "spill-camera-step"
      );
    });
    expect(firstChildrenAreIntroThenCamera).toBe(true);

    // The photo affordance leads, but it no longer blocks the fast price/story
    // path: the useful controls are visible on the first usable paint.
    await expect(cameraStep.getByRole("button", { name: /skip photo/i })).toHaveCount(0);
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();
    await expect(
      form.getByRole("group", { name: /add this spill to/i }).getByRole("button", {
        name: "Tonight",
      }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("one-tap destination + price chips render, and preview updates on price", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);

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
    await page.addInitScript(() => {
      const apply = () => document.documentElement?.setAttribute("data-legacy", "1");
      if (document.documentElement) apply();
      else window.addEventListener("DOMContentLoaded", apply, { once: true });
    });

    const { form } = await openComposer(page);

    // The core controls still render and are operable under Legacy Mode.
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();
    await expect(
      form.getByRole("group", { name: /add this spill to/i }).getByRole("button", {
        name: "Tonight",
      }),
    ).toBeVisible();
    await expect(form.locator(".spillPreviewCard")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("/map?log=1 opens the mobile composer without the full pint dataset", async ({ page }) => {
    const errors = watchPageErrors(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.setViewportSize({ width: 390, height: 844 });

    const response = await page.goto("/map?log=1");
    expect(response?.status()).toBe(200);

    const form = page.locator("form.dropComposer");
    await expect(form).toBeVisible({ timeout: 10_000 });
    await expect(form.locator('[data-testid="spill-camera-step"]')).toBeVisible();
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => performance.getEntriesByName("pubmax:composer-interactive").length),
      )
      .toBeGreaterThan(0);

    const marks = await page.evaluate(() =>
      [
        "pubmax:map-chunk-ready",
        "pubmax:slim-venues-ready",
        "pubmax:drop-route-ready",
        "pubmax:composer-mounted",
        "pubmax:composer-interactive",
      ].map((name) => ({ name, count: performance.getEntriesByName(name).length })),
    );
    expect(marks.every((mark) => mark.count > 0)).toBe(true);
    expect(requests).toContain("/data/venues_slim.json");
    expect(requests).not.toContain("/data/pint_prices_app_dataset.json");

    expect(errors).toEqual([]);
  });
});
