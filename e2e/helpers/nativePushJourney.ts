import type { Page } from "@playwright/test";

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
