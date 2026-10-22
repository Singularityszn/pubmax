import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`Tonight acknowledges its pub-matched music at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const now = Date.now();
    const observedAt = new Date(now - 60_000).toISOString();
    const gig = {
      id: "ticketmaster-pub-gig",
      venueId: "venue-1vle947",
      placeName: "The Fixture Arms",
      kind: "music",
      title: "A pub gig",
      startsAt: new Date(now + 60 * 60_000).toISOString(),
      observedAt,
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" },
      confidence: "listed",
    };
    await page.route("**/api/whats-on?**", (route) => route.fulfill({
      json: {
        rows: [gig],
        readStatus: "ready",
        servedAt: new Date(now).toISOString(),
        sourceObservedAt: observedAt,
        sourceFreshnessKind: "provider-observed",
        kindObservedAt: { music: observedAt },
        localityBasis: "london-default",
      },
    }));
    await page.route("**/api/out?**", (route) => route.fulfill({
      json: {
        status: "ready",
        listingsStatus: "ready",
        events: [gig],
        openPlans: [],
        attribution: [],
        observedAt: { ticketmaster: observedAt },
        providers: [],
        venueMatch: "ready",
      },
    }));
    await page.goto("/tonight");

    await expect(page.getByRole("heading", { name: "Live music tonight", exact: true })).toBeVisible();
    await expect(page.getByText("1 sourced live music listing below.", { exact: false })).toBeVisible();
    await expect(page.getByText("A pub gig", { exact: true })).toBeVisible();
    await expect(page.getByText("1 listing via Ticketmaster", { exact: false })).toBeVisible();
    await expect(page.getByText("No confirmed events listed tonight.", { exact: false })).toHaveCount(0);
    await expect(page.getByText("No events listed", { exact: false })).toHaveCount(0);
  });
}
