import type { Page } from "@playwright/test";

/**
 * A fixed food hygiene answer for the venue sheet.
 *
 * Most curated pubs have no entry in the committed hygiene packs, so
 * `/api/hygiene` asks the live FSA ratings service for them. An outage or a
 * rate limit there resolves to `{ rating: null }` (the route fails soft), and
 * the sheet then paints no badge. A spec that needs the badge on screen
 * answers the route itself, in the packed `fact` shape the route returns for
 * an exact OSM `fhrs:id` join (app/api/hygiene/route.ts).
 */
export async function routeHygieneBadge(page: Page): Promise<void> {
  await page.route("**/api/hygiene?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rating: null,
        fact: {
          fhrsid: 1,
          rating: "5",
          ratingDate: "2025-06-01",
          localAuthority: "Enfield",
          source: "FSA food hygiene rating open data",
          license: "OGL v3.0",
          retrievedAt: "2026-10-01T00:00:00.000Z",
        },
      }),
    }),
  );
}
