import { expect, test, type Page } from "@playwright/test";

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

async function openTonightLens(page: Page, count: number) {
  const filters = page.locator(".mobileMapTopbar").getByRole("button", { name: /^Filters/ });
  await expect(filters).toBeVisible({ timeout: 30_000 });
  await filters.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
  const lens = sheet.getByRole("button", { name: `Tonight listings: ${count}`, exact: true });
  await expect(lens).toBeVisible({ timeout: 30_000 });
  return lens;
}

test("the phone map names listing rows and keeps the label readable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await page.route("**/api/whats-on?**", (route) => route.fulfill({
    json: { rows: [listing(0), listing(1), listing(2)], asOf: null, servedAt: new Date().toISOString() },
  }));

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map");
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
    expect(heights.every((height) => height >= 44)).toBe(true);
    const lens = await openTonightLens(page, 3);
    await expect(lens.locator("strong")).toHaveText("Tonight listings");
    await expect(lens.locator("small")).toHaveText("3 listings in London");
    for (const label of [lens.locator("strong"), lens.locator("small")]) {
      const bounds = await label.evaluate((element) => ({
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
      }));
      expect(bounds.contentWidth, `Tonight text at ${width}px`).toBeLessThanOrEqual(bounds.width);
    }
    const bounds = await lens.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await lens.click();
    const tonightSheet = page.locator('.mobileSheetPortal[data-sheet-kind="tonight"]:visible');
    await expect(tonightSheet).toHaveCount(1);
    await tonightSheet.getByRole("button", { name: "Close and return to the map", exact: true }).click();
    await expect(tonightSheet).toHaveCount(0);
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
    json: { rows: Array.from({ length: 132 }, (_, index) => listing(index)), asOf: null, servedAt: new Date().toISOString() },
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
      await expect(page.locator(".mobileMapDrinkChipLabel"), where).toHaveText(lane.label);
      const drinkParts = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            bottom: rect.bottom,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        };
        return {
          drink: read(".mobileMapDrinkChip"),
          drinkLabel: read(".mobileMapDrinkChipLabel"),
          drinkIcon: read(".mobileMapDrinkChip > svg"),
          tfl: read(".mobileMapTflButton"),
        };
      });
      const { drink, drinkLabel, drinkIcon, tfl } = drinkParts;
      if (!drink || !drinkLabel || !drinkIcon) {
        throw new Error(`drink parts missing for ${where}: ${JSON.stringify(drinkParts)}`);
      }
      expect(drinkLabel.scrollWidth, `drink label, ${where}`).toBeLessThanOrEqual(drinkLabel.clientWidth);
      expect(Math.round(drinkIcon.width), `glass icon, ${where}`).toBe(15);
      expect(Math.round(drink.height), `drink chip height, ${where}`).toBe(44);
      expect(drink.width, `drink chip width, ${where}`).toBeGreaterThanOrEqual(44);
      expect(drink.left, `drink chip inside the viewport, ${where}`).toBeGreaterThanOrEqual(0);
      expect(drink.right, `drink chip inside the viewport, ${where}`).toBeLessThanOrEqual(width);
      if (tfl) {
        expect(drink.right, `drink chip clear of TfL, ${where}`).toBeLessThanOrEqual(tfl.left);
      }
      const lens = await openTonightLens(page, 132);
      await expect(lens.locator("strong"), where).toHaveText("Tonight listings");
      await expect(lens.locator("small"), where).toHaveText("132 listings in London");
      const parts = await lens.evaluate((element) => {
        const read = (part: Element) => {
          const rect = part.getBoundingClientRect();
          return {
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: rect.width, height: rect.height,
            clientWidth: part.clientWidth, scrollWidth: part.scrollWidth,
          };
        };
        return {
          tonight: read(element),
          label: read(element.querySelector("strong")!),
          icon: read(element.querySelector(":scope > svg")!),
          count: read(element.querySelector("small")!),
        };
      });
      const { tonight, label, icon, count } = parts;
      expect(label.scrollWidth, `Tonight label, ${where}`).toBeLessThanOrEqual(label.clientWidth);
      expect(count.scrollWidth, `listing count, ${where}`).toBeLessThanOrEqual(count.clientWidth);
      expect(label.bottom, `Tonight label clear of the count, ${where}`).toBeLessThanOrEqual(count.top);
      expect(Math.round(icon.width), `calendar icon, ${where}`).toBe(18);
      expect(tonight.height, `Tonight lens tap height, ${where}`).toBeGreaterThanOrEqual(44);
      expect(tonight.width, `Tonight lens tap width, ${where}`).toBeGreaterThanOrEqual(44);
      expect(tonight.left, `Tonight lens inside the viewport, ${where}`).toBeGreaterThanOrEqual(0);
      expect(tonight.right, `Tonight lens inside the viewport, ${where}`).toBeLessThanOrEqual(width);
      expect(label.left).toBeGreaterThanOrEqual(tonight.left);
      expect(label.right).toBeLessThanOrEqual(tonight.right);
      expect(count.left).toBeGreaterThanOrEqual(tonight.left);
      expect(count.right).toBeLessThanOrEqual(tonight.right);
      await lens.click();
      await expect(page.locator('.mobileSheetPortal[data-sheet-kind="tonight"]:visible')).toHaveCount(1);
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
