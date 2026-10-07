import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
test.setTimeout(90_000);

function listing(index: number) {
  return {
    id: `count-fixture-${index}`,
    kind: "quiz",
    title: `Count fixture ${index}`,
    placeName: `Count fixture venue ${index}`,
    ...(index === 0 ? { venueId: "venue-4xlgb0" } : {}),
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    source: { label: "Count fixture", url: `https://example.com/listing/${index}` },
    confidence: "listed",
  };
}

test("the phone map names listing rows and keeps the label readable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await page.route("**/api/whats-on?**", (route) => route.fulfill({
    json: { rows: [listing(0), listing(1), listing(2)], asOf: null },
  }));

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map");
    const chip = page.getByRole("button", { name: "Tonight: 3 listings", exact: true });
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText("Tonight listings");
    const label = chip.locator(".mobileMapTonightChipLabel");
    const bounds = await label.evaluate((element) => ({
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }));
    expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width);
  }
});

test("Out distinguishes listings shown from their accepted venue links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/out?**", (route) => route.fulfill({
    json: {
      status: "ready", listingsStatus: "ready", events: [listing(0), listing(1)],
      venueMatch: "ready", attribution: [], openPlans: [], openPlansStatus: "ready",
      observedAt: {}, providers: [],
    },
  }));
  await page.goto("/out");
  await expect(page.getByTestId("out-listing-count")).toHaveText(
    "2 listings shown. 1 linked to a venue on our map.",
  );
  await expect(page.getByTestId("out-listing-row")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Open on map", exact: true })).toHaveCount(1);
});

test("Out makes no match-count claim when venue matching is unavailable", async ({ page }) => {
  await page.route("**/api/out?**", (route) => route.fulfill({
    json: {
      status: "degraded", listingsStatus: "ready", events: [listing(1)],
      venueMatch: "unavailable", attribution: [], openPlans: [], openPlansStatus: "ready",
      observedAt: {}, providers: [],
    },
  }));
  await page.goto("/out");
  await expect(page.getByTestId("out-listing-count")).toHaveText("1 listing shown.");
  await expect(page.getByTestId("out-venue-match-notice")).toBeVisible();
  await expect(page.getByTestId("out-listing-row")).toHaveCount(1);
});
