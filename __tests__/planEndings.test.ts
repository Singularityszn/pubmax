import { describe, expect, it } from "vitest";

import { buildPlanEndingRecommendations } from "@/lib/planEndings";
import { getLateFoodForArea } from "@/lib/lateFood";

describe("buildPlanEndingRecommendations", () => {
  it("returns explicit Food, Get home, and Keep going choices without executing one", () => {
    const recommendations = buildPlanEndingRecommendations({
      daypart: "late_night",
      foodRequested: true,
      transportAnchor: "Piccadilly Circus",
      lateFood: getLateFoodForArea("piccadilly-soho", [], { now: Date.parse("2026-07-16T23:00:00.000Z") }),
      extensions: [
        { venueId: "venue-4", venueName: "Fourth Pub", distanceKm: 0.4, estimatedPintPricePence: 650 },
        { venueId: "venue-5", venueName: "Fifth Pub", distanceKm: 0.7, estimatedPintPricePence: null },
      ],
    });

    expect(recommendations.map((item) => item.kind)).toEqual(["food", "get_home", "keep_going"]);
    expect(recommendations.filter((item) => item.preselected)).toHaveLength(1);
    expect(recommendations.every((item) => item.requiresConfirmation)).toBe(true);
    expect(recommendations[0]?.options).toHaveLength(1);
    expect(recommendations[0]?.options[0]).toMatchObject({ closingConfidence: "unknown" });
    expect(recommendations[1]?.options[0]).toMatchObject({ label: "Piccadilly Circus" });
    expect(recommendations[2]?.options).toHaveLength(2);
  });

  it("does not claim food or extension evidence that is unavailable", () => {
    const recommendations = buildPlanEndingRecommendations({
      daypart: "evening",
      foodRequested: false,
      transportAnchor: "Barnes",
      lateFood: [],
      extensions: [],
    });

    expect(recommendations[0]?.options).toEqual([]);
    expect(recommendations[0]?.warnings).toContain("No reviewed late-food option is available for this Night Area.");
    expect(recommendations[2]?.options).toEqual([]);
  });
});
