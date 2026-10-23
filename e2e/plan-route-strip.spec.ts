import { expect, test } from "@playwright/test";

// The route strip needs a real WebGL2 context, so this spec belongs to the
// chromium-gl project. With the generator stubbed, the strip must show the
// real MapLibre canvas for the three listed pubs, in both themes, and the
// stops stay visible before it on a phone.

const STOPS = [
  { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
  { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
  { venueId: "venue-3h52h", venueName: "The Elephant Inn" },
].map((stop, position) => ({ ...stop, position, alternatives: [], reason: "Close to the heart of the area." }));

for (const theme of ["light", "dark"] as const) {
  test(`the route strip paints a real map after the cards (${theme})`, async ({ page }) => {
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
    await page.getByRole("textbox", { name: "Where, how many, what budget" }).fill("Quiet in Clapham for 4");
    await page.getByRole("button", { name: "Plan it", exact: true }).click();

    const strip = page.getByTestId("plan-route-strip");
    await expect(strip).toBeVisible({ timeout: 60_000 });
    await expect(strip.locator(".maplibregl-canvas")).toBeVisible();
    // The accepted stops-first layout keeps Stop 1 visible before the map.
    await expect(page.locator(".planStop__surface").first()).toBeInViewport({ ratio: 1 });
    const firstCardBox = (await page.locator(".planStop__surface").first().boundingBox())!;
    const lockBox = (await page.locator(".planComposer__lock").boundingBox())!;
    expect(firstCardBox.y + firstCardBox.height).toBeLessThanOrEqual(lockBox.y);
    expect(await page.locator(".planStop__open").first().evaluate((control) => {
      const box = control.getBoundingClientRect();
      return control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    const stripBox = await strip.boundingBox();
    const lastCardBox = await page.locator(".planStop__surface").last().boundingBox();
    expect(stripBox!.height).toBeGreaterThanOrEqual(200);
    expect(stripBox!.y).toBeGreaterThanOrEqual(lastCardBox!.y + lastCardBox!.height - 1);
    await strip.scrollIntoViewIfNeeded();

    // A reorder re-routes the same map: the canvas is kept, never torn down to
    // the pending placeholder and rebuilt.
    await strip.locator(".maplibregl-canvas").evaluate((canvas) => { (canvas as HTMLElement).dataset.kept = "yes"; });
    await page.locator(".planStop__open").nth(1).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.locator(".planStop__name")).toHaveText(["The Bohemia", "Arnos Arms", "The Elephant Inn"]);
    await expect(page.getByTestId("plan-route-strip-pending")).toHaveCount(0);
    await expect(strip.locator('.maplibregl-canvas[data-kept="yes"]')).toBeVisible();
    await expect(strip).toContainText("Walking route between The Bohemia, Arnos Arms, The Elephant Inn.", { timeout: 15_000 });
  });
}
