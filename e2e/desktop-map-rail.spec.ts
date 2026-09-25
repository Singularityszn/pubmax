import { test, expect, type Page } from "@playwright/test";

// D3.1/D3.2 — the desktop map right-rail (Conditions + Area news) built on the
// shared DesktopRail host. The rail is map chrome (a sibling of the toolbar,
// outside the WebGL canvas), so it renders on desktop regardless of whether the
// basemap gets a GL context — these assertions never touch the canvas.
//
// Both endpoints are mocked so the fail-soft blocks have something to render:
// ConditionsChip shows only when the weather has a verdict, AreaNewsRail only
// when the area has dated facts.

function seedDismissedChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function mockRailData(page: Page): Promise<void> {
  await page.route("**/api/tonight-conditions**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          dateLabel: "Thursday 23 Jul",
          weatherLabel: "18°C, light cloud",
          factsLine: "18°C feels like, light cloud, 10% chance of rain, 12 km/h wind, sunset 21:08, daylight.",
          stale: false,
          checkedLabel: "Checked 20 minutes ago",
          drinkLine: "Warm and dry. Beer garden weather.",
          drinkSuggestion: "a cold lager or cider",
          venueClaim: null,
        },
      }),
    }),
  );
  await page.route("**/api/area-news**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          {
            id: "e2e-area-news-1",
            kind: "opening",
            title: "A new taproom opened this week",
            sourceUrl: "https://example.com/story",
            sourceName: "Example Times",
            observedAt: "2026-07-22T18:00:00.000Z",
          },
        ],
      }),
    }),
  );
}

test.describe("desktop map right-rail (D3.1/D3.2)", () => {
  test("keeps the toolbar inside the centred boundary from 641 to 900px", async ({
    page,
  }) => {
    await seedDismissedChrome(page);
    await mockRailData(page);
    await page.setViewportSize({ width: 641, height: 900 });
    const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 20000 });

    for (const width of [641, 800, 900]) {
      await page.setViewportSize({ width, height: 900 });

      const toolbar = page.locator(".mapToolbar");
      const city = toolbar.locator(".citySwitcher");
      await expect(toolbar).toBeVisible({ timeout: 20000 });
      await expect(city).toBeVisible();
      // PlanAstra item 9: the venue-type chips are behind the toolbar's own
      // Filters control from 641px up, so nothing of theirs floats over the map.
      await expect(page.locator(".tonightArcChips")).toHaveCount(0);
      await expect(toolbar.locator(".mapVenueKindFilterBtn")).toBeVisible();

      const bounds = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const toolbarRect = rect(".mapToolbar");
        const cityRect = rect(".mapToolbar .citySwitcher");
        return {
          toolbarLeft: toolbarRect.left,
          toolbarRight: toolbarRect.right,
          cityLeft: cityRect.left,
          cityRight: cityRect.right,
        };
      });

      expect(bounds.toolbarLeft, `${width}px toolbar left`).toBeGreaterThanOrEqual(15);
      expect(bounds.toolbarRight, `${width}px toolbar right`).toBeLessThanOrEqual(width - 15);
      expect(bounds.cityLeft, `${width}px city inside toolbar left`).toBeGreaterThanOrEqual(
        bounds.toolbarLeft,
      );
      expect(bounds.cityRight, `${width}px city inside toolbar right`).toBeLessThanOrEqual(
        bounds.toolbarRight,
      );
    }
  });

  test("gives every desktop venue-type chip a 44px floor and 8px gaps", async ({
    page,
  }) => {
    await seedDismissedChrome(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 20000 });
    await page
      .locator(".mapToolbar .mapVenueKindFilterBtn")
      .click();
    const arc = page.locator(".mapVenueKindFilterPanel .tonightArcChips");
    await expect(arc).toBeVisible({ timeout: 20000 });

    // Group by the line the chips are PAINTED on, not by the DOM row. The row
    // is one flex container that wraps, so reading it as one line measured the
    // gap from the last chip on line one to the first on line two and called
    // -194.875px a violation of an 8px floor.
    const layout = await arc.evaluate((element) => {
      const boxes = [...element.querySelectorAll<HTMLElement>(".tonightArcChip")].map(
        (chip) => {
          const rect = chip.getBoundingClientRect();
          return {
            label: chip.textContent?.trim() ?? "",
            top: Math.round(rect.top),
            left: rect.left,
            right: rect.right,
            height: rect.height,
            width: rect.width,
          };
        },
      );
      const lines = new Map<number, typeof boxes>();
      for (const box of boxes) {
        const line = lines.get(box.top) ?? [];
        line.push(box);
        lines.set(box.top, line);
      }
      return [...lines.values()].map((line) =>
        [...line].sort((a, b) => a.left - b.left),
      );
    });

    const chips = layout.flat();
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.height, `${chip.label} height`).toBeGreaterThanOrEqual(44);
      expect(chip.width, `${chip.label} width`).toBeGreaterThanOrEqual(44);
    }
    for (const row of layout) {
      for (let index = 1; index < row.length; index += 1) {
        const gap = row[index]!.left - row[index - 1]!.right;
        expect(
          gap,
          `gap before ${row[index]!.label}`,
        ).toBeGreaterThanOrEqual(8 - 0.5);
      }
    }
  });

  test("keeps venue-type chips clickable inside the desktop Filters popover", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedDismissedChrome(page);

    const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 20000 });
    const filters = page.locator(".mapToolbar .mapVenueKindFilterBtn");
    await filters.click();
    const bars = page.getByRole("button", { name: "Bars", exact: true });
    await expect(bars).toHaveAttribute("aria-pressed", "true");
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "false");
    // The count rides the closed control, so no filter is invisible.
    await expect(filters.locator(".mapVenueKindFilterCount")).toHaveText("1");
    // The panel holds three questions now, not one: the venue types, the
    // experience lens and the fare zones all moved in behind this control
    // (7 Sep 2026, walk finding B9). So the count covers every refinement the
    // panel holds, and the accessible name says what the count counts. A badge
    // that counted one of three would call the map unfiltered while two
    // filters were on (lib/venueKindFilters.ts, mapFilterRefinementCount).
    await expect(filters).toHaveAttribute(
      "aria-label",
      "Filters: venue types, view and zone, 1 filter on",
    );
  });

  test("shows the rail with Area news at 1440, and keeps the conditions verdict to its one home", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedDismissedChrome(page);
    await mockRailData(page);

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    // Desktop chrome is present independent of the canvas.
    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 20000 });

    const rail = page.locator(".desktopRail.mapRail");
    await expect(rail).toBeVisible({ timeout: 20000 });

    // Area news renders inside the rail when the area is known.
    await expect(rail.locator(".areaNewsRail")).toBeVisible();

    // The conditions verdict used to have TWO homes, this rail and a toolbar
    // chip, with a CSS rule hiding whichever was the duplicate. It has ONE now,
    // inside the Layers popover, and it is not on the map at arrival at all
    // (captain, 7 Sep 2026, walk finding B9: the arrival set at 1440 is eight
    // controls). So neither the rail nor the toolbar carries it.
    await expect(rail.locator(".conditionsChip")).toHaveCount(0);
    await expect(page.locator(".mapToolbar .conditionsChip")).toHaveCount(0);

    // It is a tap away, where the map's own layers and camera live.
    await page.locator(".mapLayersControl button").first().click();
    await expect(
      page.locator(".mapLayersPanel .conditionsChip"),
    ).toContainText(/light cloud/i, { timeout: 20_000 });
  });

  test("does not render the rail on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedDismissedChrome(page);
    await mockRailData(page);

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    // The mobile map shell owns this viewport; the desktop rail is never mounted.
    await expect(page.locator(".desktopRail.mapRail")).toHaveCount(0);
  });
});
