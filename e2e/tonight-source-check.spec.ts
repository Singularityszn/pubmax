import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`Tonight distinguishes an event date from its source check at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const now = new Date().toISOString();
    const event = {
      id: "unmatched-dated-event",
      placeName: "A concert hall",
      title: "A dated concert",
      kind: "music",
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      observedAt: now,
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" },
      confidence: "listed",
    };
    await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: {
      rows: [], readStatus: "ready", servedAt: now,
      sourceFreshnessKind: "unknown", kindObservedAt: {}, localityBasis: "london-default",
    } }));
    await page.route("**/api/out?**", (route) => route.fulfill({ json: {
      status: "ready", listingsStatus: "ready", venueMatch: "ready",
      events: [event], openPlans: [], attribution: [], providers: [],
      observedAt: { ticketmaster: now }, unmatchedCount: 1,
    } }));
    await page.goto("/tonight");
    await expect(page.getByText("Some event listings are not matched to a pub.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`source-check-${width}.png`), fullPage: true });
    const credit = page.locator('[data-tonight-provenance="out"]');
    await expect(credit).toContainText("No pub-matched events");
    await expect(credit).toContainText("Ticketmaster");
    await expect(credit).toContainText("Checked");
    await expect(page.getByText("A dated concert", { exact: true })).toHaveCount(0);
    await expect(page.getByText("We can’t date these listings yet.", { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-tonight-provenance="undated-whats-on"]'))
      .toHaveText("The source check date is not recorded.");
    await page.screenshot({ path: testInfo.outputPath(`source-check-${width}.png`), fullPage: true });
  });

  test(`Tonight keeps an invalid row's source check unknown at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const now = new Date().toISOString();
    const event = {
      placeName: "A concert hall", title: "A dated concert", kind: "music",
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" },
      confidence: "listed",
    };
    await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: {
      rows: [], readStatus: "ready", servedAt: now,
      sourceFreshnessKind: "unknown", kindObservedAt: {}, localityBasis: "london-default",
    } }));
    await page.route("**/api/out?**", (route) => route.fulfill({ json: {
      status: "ready", listingsStatus: "ready", venueMatch: "ready",
      events: [{ ...event, id: "dated", observedAt: now }, { ...event, id: "unknown", observedAt: "not-a-date" }],
      openPlans: [], attribution: [], providers: [], observedAt: { ticketmaster: now },
    } }));
    await page.goto("/tonight");
    const credit = page.locator('[data-tonight-provenance="out"]');
    await expect(credit).toHaveText("No pub-matched events via Ticketmaster");
    await expect(page.locator('[data-tonight-provenance="undated-out"]'))
      .toHaveText("The source check date is not recorded.");
    await page.screenshot({ path: testInfo.outputPath(`shared-source-${width}.png`), fullPage: true });
  });
}
