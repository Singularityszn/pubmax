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
    json: { servedAt: new Date().toISOString(), rows: [listing(0), listing(1), listing(2)], asOf: null },
  }));

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map");
    const chip = page.getByRole("button", { name: "Tonight listings: 3", exact: true });
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText("Tonight listings");
    const label = chip.locator(".mobileMapTonightChipLabel");
    const bounds = await label.evaluate((element) => ({
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }));
    expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width);
    // The longer label must not squeeze its neighbour: the drink lane keeps
    // every letter and the row stays one height.
    const drink = page.locator(".mobileMapDrinkChipLabel");
    await expect(drink).toHaveText("Pints");
    const drinkBounds = await drink.evaluate((element) => ({
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }));
    expect(drinkBounds.contentWidth, `drink label at ${width}px`).toBeLessThanOrEqual(drinkBounds.width);
    const heights = await page.locator(".mobileMapChipRow > button").evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().height)));
    expect(new Set(heights).size, `chip heights at ${width}px: ${heights.join(", ")}`).toBe(1);
  }
});

test("the longest drink lanes keep a three-digit Tonight count whole on a 320px phone", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await page.route("**/api/whats-on?**", (route) => route.fulfill({
    json: { servedAt: new Date().toISOString(), rows: Array.from({ length: 132 }, (_, index) => listing(index)), asOf: null },
  }));

  const lanes = [
    { drink: "beer", label: "Pints" },
    { drink: "soft-drink", label: "Soft drinks" },
    { drink: "alcohol-free", label: "Alcohol-free" },
  ];
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 844 });
    for (const lane of lanes) {
      const where = `${lane.drink} at ${width}px`;
      await page.goto(`/map?drink=${lane.drink}`);
      const chip = page.getByRole("button", { name: "Tonight listings: 132", exact: true });
      await expect(chip, where).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".mobileMapDrinkChipLabel"), where).toHaveText(lane.label);
      await expect(chip.locator(".mobileMapTonightChipCount"), where).toHaveText("132");
      const parts = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        };
        return {
          drink: read(".mobileMapDrinkChip"),
          drinkLabel: read(".mobileMapDrinkChipLabel"),
          drinkIcon: read(".mobileMapDrinkChip > svg"),
          tonight: read(".mobileMapTonightChip"),
          label: read(".mobileMapTonightChipLabel"),
          moon: read(".mobileMapTonightChip > svg"),
          count: read(".mobileMapTonightChipCount"),
          tfl: read(".mobileMapTflButton"),
        };
      });
      const { drink, drinkLabel, drinkIcon, tonight, label, moon, count, tfl } = parts;
      if (!drink || !drinkLabel || !drinkIcon || !tonight || !label || !moon || !count) {
        throw new Error(`chip parts missing for ${where}: ${JSON.stringify(parts)}`);
      }
      // Every word and the whole count are on screen: nothing clips or squeezes.
      expect(drinkLabel.scrollWidth, `drink label, ${where}`).toBeLessThanOrEqual(drinkLabel.clientWidth);
      expect(label.scrollWidth, `Tonight label, ${where}`).toBeLessThanOrEqual(label.clientWidth);
      expect(count.scrollWidth, `count badge, ${where}`).toBeLessThanOrEqual(count.clientWidth);
      expect(label.right, `Tonight label runs under the count, ${where}`).toBeLessThanOrEqual(count.left);
      expect(Math.round(drinkIcon.width), `glass icon, ${where}`).toBe(15);
      expect(Math.round(moon.width), `moon icon, ${where}`).toBe(15);
      // Both controls keep the 44px tap floor and stop short of the TfL lane.
      expect(Math.round(drink.height), `drink chip height, ${where}`).toBe(44);
      expect(Math.round(tonight.height), `Tonight chip height, ${where}`).toBe(44);
      expect(tonight.right, `Tonight chip inside the viewport, ${where}`).toBeLessThanOrEqual(width);
      if (tfl) {
        expect(tonight.right, `Tonight chip clear of TfL, ${where}`).toBeLessThanOrEqual(tfl.left);
      }
      await page.screenshot({ path: test.info().outputPath(`map-${lane.drink}-${width}.png`) });
    }
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
