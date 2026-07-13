import { test, expect, type Page } from "@playwright/test";

// Map story-surface E2E: the band picker DOM overlay (issue #15) and the venue
// sheet's tab system (VenueInspector), including the "Last Pint" getting-home
// tab (issues #19-24). All WebGL-agnostic — these are DOM overlays that sit on
// top of the MapLibre canvas, never assertions on canvas pixels or pin clicks.
//
// Style matches e2e/smoke.spec.ts / e2e/social-loop.spec.ts: watchPageErrors on
// deterministic surfaces, .count()-guarded branches so an empty/filtered state
// is never a failure, web-first (auto-retrying) assertions, no waitForTimeout.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Dismiss / explore the map" });
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
    await expect(page.locator(".mapOnboarding")).toHaveCount(0);
  }
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey (same tiny,
// stable, public hash used by e2e/smoke.spec.ts) so we can deep-link straight
// to a known seed pub's detail sheet without depending on canvas pin clicks.
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

// A known seed row from public/data/pint_prices_app_dataset.json ("Arnos
// Arms") — same stable id smoke.spec.ts deep-links to.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

// ---------------------------------------------------------------------------
// Place stories live in MapLayersControl after Wave J declutter (was mid-map
// .bandPicker / .bandActiveCard). Deep-link ?band= opens Layers with the
// corridor chip active; bandOnboardingChip still surfaces corridor copy.
test.describe("map / story bands (#15)", () => {
  test("activating a band via URL opens Layers with the corridor chip active", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/map?band=river-history");
    expect(response?.status()).toBe(200);

    const layers = page.getByRole("dialog", { name: "Map layers" });
    await expect(layers).toBeVisible();

    const activeChip = layers.locator(".mapLayersChip.isOn").filter({ hasText: "River history" });
    await expect(activeChip).toHaveCount(1);

    // G3 chip still carries corridor title + truncated copy for deep links.
    const bandChip = page.locator(".bandOnboardingChip");
    if ((await bandChip.count()) > 0) {
      await expect(bandChip.locator("strong")).toHaveText(/River history/i);
      const copy = (await bandChip.locator("span").first().innerText()).trim();
      expect(copy.length).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });

  test("tapping the active band chip again clears it (toggle off)", async ({ page }) => {
    await page.goto("/map?band=river-history");
    const layers = page.getByRole("dialog", { name: "Map layers" });
    await expect(layers).toBeVisible();
    await dismissOnboardingIfPresent(page);

    const activeChip = layers.locator(".mapLayersChip.isOn").filter({ hasText: "River history" });
    await expect(activeChip).toHaveCount(1);
    await activeChip.click();

    await expect(
      layers.locator(".mapLayersChip.isOn").filter({ hasText: "River history" }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Venue sheet tabs (components/map/VenueInspector.tsx). Six tabs (Pub,
// Drops, Menu, Lore, Ask, Last train) behind role="tablist"/role="tab", with
// roving-tabindex arrow-key navigation per the APG tabs pattern. Deep-link
// straight to a known seed venue (mirrors smoke.spec's sel= precedent) so this
// never depends on a canvas pin click.
test.describe("map / venue sheet tabs", () => {
  test("all six tabs render; each switches its panel; Drops shows the price block", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    expect(response?.status()).toBe(200);

    const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
    await expect(tablist).toBeVisible();

    const expectedTabs = ["Pub", "Drops", "Menu", "Lore", "Ask", "Last train"];
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    for (const label of expectedTabs) {
      await expect(tablist.getByRole("tab", { name: label, exact: true })).toBeVisible();
    }

    // Drops is the default tab (VenueInspector's DEFAULT_TAB) — its panel is
    // visible immediately, and the pintDrops section (the price/community block)
    // renders inside it.
    const pintsTab = tablist.getByRole("tab", { name: "Drops", exact: true });
    await expect(pintsTab).toHaveAttribute("aria-selected", "true");
    const pintsPanel = page.locator("#venuePanel-pints");
    await expect(pintsPanel).toBeVisible();
    await expect(pintsPanel.locator(".pintDrops")).toBeVisible();

    // Switch to every other tab by click; assert its panel becomes visible and
    // the others are hidden (aria-selected flips, hidden attr flips).
    for (const [label, panelId] of [
      ["Pub", "venuePanel-overview"],
      ["Menu", "venuePanel-menu"],
      ["Lore", "venuePanel-story"],
      ["Ask", "venuePanel-ask"],
      ["Last train", "venuePanel-getting-home"],
    ] as const) {
      const tab = tablist.getByRole("tab", { name: label, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(pintsTab).toHaveAttribute("aria-selected", "false");
      await expect(page.locator(`#${panelId}`)).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test("arrow-key navigation moves the roving tab selection", async ({ page }) => {
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
    const pintsTab = tablist.getByRole("tab", { name: "Drops", exact: true });
    await expect(pintsTab).toHaveAttribute("aria-selected", "true");
    await pintsTab.focus();

    // ArrowRight from Drops (index 1) moves to Menu (index 2) and moves focus
    // with it (roving tabindex — VenueInspector's selectTab calls .focus()).
    await page.keyboard.press("ArrowRight");
    const menuTab = tablist.getByRole("tab", { name: "Menu", exact: true });
    await expect(menuTab).toHaveAttribute("aria-selected", "true");
    await expect(menuTab).toBeFocused();
    await expect(page.locator("#venuePanel-menu")).toBeVisible();

    // ArrowLeft moves back to Drops.
    await page.keyboard.press("ArrowLeft");
    await expect(pintsTab).toHaveAttribute("aria-selected", "true");
    await expect(pintsTab).toBeFocused();

    // Wrap-around: ArrowLeft from the first tab (Pub) wraps to the last
    // (Last train).
    const overviewTab = tablist.getByRole("tab", { name: "Pub", exact: true });
    await overviewTab.click();
    await page.keyboard.press("ArrowLeft");
    const gettingHomeTab = tablist.getByRole("tab", { name: "Last train", exact: true });
    await expect(gettingHomeTab).toHaveAttribute("aria-selected", "true");
  });

  test("the community-price freshness note renders when a contributor price exists, and Drops stays well-formed when absent", async ({
    page,
  }) => {
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    const overviewTab = page.getByRole("tab", { name: "Pub", exact: true });
    await overviewTab.click();
    const overviewPanel = page.locator("#venuePanel-overview");
    await expect(overviewPanel).toBeVisible();

    // The contributor-price block (with its freshness note) renders ONLY when a
    // latestContributorPrice is set — guard with .count() so this is honest on
    // both a venue with contributor drops and one without.
    const contributorBlock = overviewPanel.locator(".contributorPrice");
    const blockCount = await contributorBlock.count();
    if (blockCount > 0) {
      await expect(contributorBlock.locator("strong")).toBeVisible();
      await expect(contributorBlock.locator(".communityPriceNote")).toContainText(
        /community-updated|not a live tonight feed/i,
      );
    } else {
      // Absent gracefully: the Overview panel still renders a coherent surface
      // (address is always present) rather than a half-empty gap.
      await expect(overviewPanel.locator(".venueAddress")).toBeVisible();
    }
  });

  // "The Spill" composer (issue #24): visibility segmented control. Deep-link
  // to Drops (the composer's tab), open it via the sticky "Log a Pint Drop"
  // button, and assert the four-option visibility radiogroup renders with
  // Public selected by default — a cheap DOM check, no submit/network needed.
  test("opening the composer renders the visibility control, defaulted to Public", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    const pintsPanel = page.locator("#venuePanel-pints");
    await expect(pintsPanel).toBeVisible();

    await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();

    const visibilityGroup = pintsPanel.getByRole("radiogroup", { name: "Visibility" });
    await expect(visibilityGroup).toBeVisible();

    const options = visibilityGroup.getByRole("radio");
    await expect(options).toHaveCount(4);
    for (const label of ["Public", "Friends", "Legacy", "Anonymous"]) {
      await expect(visibilityGroup.getByRole("radio", { name: label })).toBeVisible();
    }

    const publicOption = visibilityGroup.getByRole("radio", { name: "Public" });
    await expect(publicOption).toHaveAttribute("aria-checked", "true");

    expect(errors).toEqual([]);
  });
});
