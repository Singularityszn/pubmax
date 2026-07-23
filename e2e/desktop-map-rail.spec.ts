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
          weatherLabel: "18C, light cloud",
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
  test("shows the rail with Conditions + Area news at 1440, and hides the toolbar's duplicate chip", async ({
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

    // Conditions renders inside the rail (owner: always-on when data exists).
    await expect(rail.locator(".conditionsChip")).toBeVisible();
    await expect(rail.locator(".conditionsChip")).toContainText(/light cloud/i);

    // Area news renders inside the rail when the area is known.
    await expect(rail.locator(".areaNewsRail")).toBeVisible();

    // No duplicate Conditions: while the rail is up (drawer closed) the toolbar's
    // own chip is hidden — the rail carries the verdict instead.
    await expect(page.locator(".mapToolbar .conditionsChip")).toBeHidden();
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
