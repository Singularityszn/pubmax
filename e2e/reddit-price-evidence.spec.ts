import { expect, test } from "@playwright/test";

const VENUE_ID = "venue-16pnwmm";
const SOURCE_URL = "https://www.reddit.com/r/london/comments/1abc234/price_evidence/mabc234/";

for (const width of [390, 768, 1440]) {
  test(`Reddit evidence preserves its attribution and the direct price lane at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    // Synthetic API evidence exercises the production decoder. No fixture is
    // written into a published price pack and no Reddit request is made.
    await page.route("**/api/price-submit**", async (route) => {
      if (route.request().method() !== "GET" || new URL(route.request().url()).searchParams.get("venueId") !== VENUE_ID) return route.continue();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        prices: [{ id: "direct-fixture", venueId: VENUE_ID, drinkCategory: "beer", priceGbp: 6.4,
          submittedAt: Date.now() - 60_000, source: "community", corroborations: 1,
          drinkName: "Lager", measure: "pint" }],
        signals: [],
        communityEvidence: [{ id: "reddit-fixture", venueId: VENUE_ID, drinkCategory: "beer",
          drinkName: "Guinness", measure: "half", priceGbp: 3.25,
          observedAt: new Date(Date.now() - 120_000).toISOString(), source: "reddit",
          sourceUrl: SOURCE_URL, confidence: 0.9 }],
      }) });
    });
    await page.goto(`/map?sel=${VENUE_ID}`);
    const inspector = page.locator(".venueInspector:visible");
    const expand = page.getByRole("button", { name: "Expand sheet", exact: true });
    await expect.poll(async () => (await inspector.count()) > 0 || await expand.isVisible()).toBe(true);
    if (!(await inspector.count()) && await expand.isVisible()) await expand.click();
    await expect(inspector).toBeVisible();
    const citation = inspector.getByRole("link", { name: "Reported on Reddit", exact: true });
    await expect(citation).toHaveAttribute("href", SOURCE_URL);
    const evidence = citation.locator("xpath=ancestor::section[1]");
    await expect(evidence).toContainText("Guinness");
    await expect(evidence).toContainText("Half");
    await expect(evidence).toContainText("£3.25");
    await expect(evidence).not.toContainText("Logged by a PUBMAXXER");
    await expect(evidence.getByRole("button")).toHaveCount(0);
    await expect(inspector.getByText("Logged by a PUBMAXXER", { exact: false })).toBeVisible();
    await expect(inspector.getByText("£6.40", { exact: true }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await citation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`reddit-evidence-${width}.png`) });
  });
}
