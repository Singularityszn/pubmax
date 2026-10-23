import { expect, test, type Locator, type Page } from "@playwright/test";

const ARNOS_ARMS_ID = "venue-xjf3n0";

async function seedChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function expectTapTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  // A popover opens with a scale-in, so a box read in its first frames is a
  // few percent short (42.9px for a 44px floor). Read until it settles.
  await expect
    .poll(async () => (await locator.boundingBox())?.width ?? 0, { message: `${label} width` })
    .toBeGreaterThanOrEqual(44);
  await expect
    .poll(async () => (await locator.boundingBox())?.height ?? 0, { message: `${label} height` })
    .toBeGreaterThanOrEqual(44);
}

// A tap that lands before React attaches is dropped, so the tap is retried
// until the control says it is open (same idiom as e2e/plan-invite.spec.ts).
async function openDisclosure(trigger: Locator): Promise<void> {
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test.setTimeout(90_000);

test("desktop map camera and favourite-pint controls meet the tap floor", async ({ page }) => {
  await seedChrome(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 45_000 });
  // Since #1631 the arrival row carries eight controls. The pint brand moved
  // behind the control that names the drink, and Show all moved into the
  // Layers popover, so each is measured in the home a reader opens.
  await openDisclosure(page.getByRole("button", { name: "Drink: Pints" }));
  await expectTapTarget(
    page.locator(".mapToolbarDrinks .favoritePintControl"),
    "favourite pint control",
  );
  await openDisclosure(page.locator(".mapLayersFab"));
  await expectTapTarget(page.locator(".mapLayersPanel .mapFitLondonBtn"), "map fit control");
});

test("existing Last Train destinations keep Cancel at the tap floor", async ({ page }) => {
  await seedChrome(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem("pubmax:last-train-destination:v1", "Home");
  });
  await page.route("**/api/last-train**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        station: { id: "station", name: "Arnos Grove", distanceM: 320 },
        trains: [],
        departures: [],
        nearestPubs: [],
        generatedAt: new Date().toISOString(),
        decision: {
          decision: "live_data_unavailable",
          leaveByIso: null,
          stationName: "Arnos Grove",
          lineNames: [],
          disruptionSummary: null,
          walkMinutesEstimate: 0,
          bufferMinutes: 5,
          destinationLabel: "Home",
          live: false,
        },
      }),
    }),
  );
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  await page.locator("#venueSection-getting-home summary").click();
  const card = page.getByLabel("Last Pint");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Change", exact: true }).click();
  await expectTapTarget(card.getByRole("button", { name: "Cancel", exact: true }), "destination cancel");
});
