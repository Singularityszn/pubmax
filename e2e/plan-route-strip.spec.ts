import { expect, test } from "@playwright/test";

// The route strip needs a real WebGL2 context, so this spec belongs to the
// chromium-gl project. With the generator stubbed, the strip must show the
// real MapLibre canvas for the three listed pubs, in both themes, and the
// stops stay as cards beneath it.

const STOPS = [
  { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
  { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
  { venueId: "venue-3h52h", venueName: "The Elephant Inn" },
].map((stop, position) => ({ ...stop, position, alternatives: [], reason: "Close to the heart of the area." }));

for (const theme of ["light", "dark"] as const) {
  test(`the route strip paints a real map above the cards (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax-theme", value);
    }, theme);
    await page.route("**/api/plans/generate", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          grounded: true, groundingProof: "stub", operationKey: "stub",
          inferredContext: { nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4, budget: "value", stopCount: 3, atmosphere: [], foodNeeds: [], accessibilityNeeds: [], zeroProof: false, drinkCategory: null, budgetLimitPence: null, transportConstraints: [], wetherspoonsPreferred: false },
          stops: STOPS, alternatives: [],
        }),
      }),
    );
    await page.goto("/plan");
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Describe the outing" }).fill("Quiet in Clapham for 4");
    await page.getByRole("button", { name: "Sort it", exact: true }).click();

    const strip = page.getByTestId("plan-route-strip");
    await expect(strip).toBeVisible({ timeout: 60_000 });
    await expect(strip.locator(".maplibregl-canvas")).toBeVisible();
    // 200px on a phone, and the first card starts below it, never over it.
    const stripBox = await strip.boundingBox();
    const cardBox = await page.locator(".planStop__surface").first().boundingBox();
    expect(stripBox!.height).toBeGreaterThanOrEqual(200);
    expect(cardBox!.y).toBeGreaterThan(stripBox!.y + stripBox!.height - 1);
  });
}
