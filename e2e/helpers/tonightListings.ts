import type { Page } from "@playwright/test";

/** Independent listings for control checks that must not depend on live feeds. */
export async function mockTonightListings(page: Page, state: "ready" | "empty" | "degraded" = "ready") {
  if (state === "degraded") {
    await page.route("**/api/whats-on?**", route => route.fulfill({ status: 503, json: { error: "Listings unavailable." } }));
    await page.route("**/api/out?**", route => route.fulfill({ status: 503, json: { error: "Listings unavailable." } }));
    return;
  }
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  const startsAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const rows = state === "empty" ? [] : [
    { id: "tonight-music", venueId: "venue-3h52h", placeName: "The Blue Note", kind: "music", title: "Live Jazz" },
    { id: "tonight-quiz", venueId: "venue-lrz4u2", placeName: "The Sharp Wit", kind: "quiz", title: "Pub Quiz" },
  ].map(row => ({ ...row, startsAt, observedAt, confidence: "listed",
    source: { label: "Independent listings", url: "https://listings.example/tonight" } }));
  await page.route("**/api/whats-on?**", route => route.fulfill({ json: {
    rows, servedAt: observedAt, asOf: observedAt, sourceObservedAt: observedAt,
    sourceFreshnessKind: "provider-observed", localityBasis: "london-default",
  } }));
  await page.route("**/api/out?**", route => route.fulfill({ json: {
    status: "ready", events: [], openPlans: [], attribution: [], observedAt: {}, providers: [],
  } }));
}
