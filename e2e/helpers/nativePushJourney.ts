import type { Page } from "@playwright/test";

/**
 * Pin the page clock to a London evening.
 *
 * The main Tonight tab follows the London clock (lib/useNowHref.ts).
 * Fix the clock so a journey that expects /tonight does not depend on the
 * suite's start time. README.md owns the Day and Tonight navigation schedule.
 */
export async function pinLondonEvening(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-10-26T20:00:00Z"));
}

type MarkedWindow = Window & { __pubmaxDocumentMark?: true };

/**
 * Mark the live document, so a later read can tell an in-app navigation from a
 * fresh boot. performance.timeOrigin cannot tell them apart once the clock is
 * pinned: the fake clock reports the pinned instant as every document's origin.
 */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as MarkedWindow).__pubmaxDocumentMark = true;
  });
}

/** True while the document marked by markDocument is still the live one. */
export async function isMarkedDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as MarkedWindow).__pubmaxDocumentMark === true);
}

export async function installSuccessfulPlanRoute(page: Page): Promise<void> {
  await page.route("**/api/plans/generate", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stops: [
          { venueId: "venue-lrz4u2", venueName: "First Pub" },
          { venueId: "venue-1f5ygjb", venueName: "Second Pub" },
          { venueId: "venue-3h52h", venueName: "Third Pub" },
        ],
        inferredContext: {
          nightArea: "clapham",
          daypart: "evening",
          partyType: "friends",
          groupSize: 4,
          budget: "standard",
          budgetLimitPence: null,
          zeroProof: false,
          wetherspoonsPreferred: false,
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        planningConfidence: {
          level: "high",
          score: 90,
          routeReady: true,
          missingEvidence: [],
          warnings: [],
          provenance: [{ kind: "night_area_review", label: "Reviewed Night Area" }],
        },
        budgetSummary: {
          currency: "GBP",
          limitPence: null,
          estimatedPerPersonPence: 1800,
          estimatedCrewPence: 7200,
          withinLimit: null,
          basis: "one-recorded-pint-per-stop",
        },
        routeTotals: {
          stopCount: 3,
          straightLineWalkingKm: 1.4,
          estimatedWalkingMinutes: 18,
          distanceBasis: "straight-line",
        },
        endingRecommendations: ["food", "get_home", "keep_going"].map((kind, index) => ({
          kind,
          label: ["Find food", "Get home", "Keep going"][index],
          reason: "Review the route ending before you commit.",
          preselected: kind === "get_home",
          requiresConfirmation: true,
          confidence: "high",
          warnings: [],
          options: [],
        })),
      }),
    });
  });
}
