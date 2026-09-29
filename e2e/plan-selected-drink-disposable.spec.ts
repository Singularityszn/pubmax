import { expect, test } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

for (const journey of [
  { category: "wine", query: "Quiet wine in Clapham for 2, not pricey", venueId: "venue-11e0hkh", pence: 675 },
  { category: "cocktail", query: "Cheap cocktails in Clapham for 2", venueId: "venue-11e0hkh", pence: 895 },
] as const) {
  test(`${journey.category} browser generation reads corroborated disposable PostgREST price`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.removeItem("pubmax:plan-intake:v1");
      localStorage.removeItem("pubmaxx:plan-route-draft:v1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.removeItem("pubmax:plan-draft:v1");
    });
    expect((await page.goto("/plan"))?.status()).toBe(200);
    await describeFirstQuery(page).fill(journey.query);
    const generation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans/generate");
    await describeFirstSubmit(page).click();
    const response = await generation;
    expect(response.status()).toBe(200);
    const generated = await response.json() as {
      inferredContext?: { drinkCategory?: string };
      stops?: Array<{ venueId: string; selectedDrinkPriceEvidence?: { category: string; pence: number; source: string } }>;
    };
    expect(generated.inferredContext?.drinkCategory).toBe(journey.category);
    const pricedStop = generated.stops?.find((stop) => stop.venueId === journey.venueId);
    expect(pricedStop?.selectedDrinkPriceEvidence).toMatchObject({
      category: journey.category, pence: journey.pence, source: "community",
    });
    await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toBeVisible();
    await page.locator(".planComposer__stopReason").filter({ hasText: "community report" }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${journey.category}-priced-preview.png`), animations: "disabled" });
  });
}
