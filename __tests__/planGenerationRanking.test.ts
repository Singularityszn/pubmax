import { describe, expect, it } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { NightContext } from "@/lib/nightPlanning";
import { scoreVenueForPlan } from "@/lib/planGenerationRanking";

function venue(canonical: boolean): ConciergeVenue {
  return {
    id: canonical ? "canonical" : "non-canonical",
    name: canonical ? "Canonical venue" : "Non-canonical venue",
    area: "Camden",
    lat: 51.54,
    lng: -0.14,
    cheapestPrice: null,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical,
  };
}

const AFTER_WORK_GROUP: NightContext = {
  nightArea: "camden",
  daypart: "after_work",
  partyType: "friends",
  groupSize: 8,
  budget: "standard",
  budgetLimitPence: null,
  zeroProof: false,
  atmosphere: [],
  foodNeeds: [],
  accessibility: [],
  transportConstraints: [],
};

describe("Plan generation ranking evidence", () => {
  it("does not let canonical status imply after-work reliability or group capacity", () => {
    const canonical = scoreVenueForPlan(venue(true), AFTER_WORK_GROUP, 0.5, [], [], null);
    const nonCanonical = scoreVenueForPlan(venue(false), AFTER_WORK_GROUP, 0.5, [], [], null);

    expect(canonical.score).toBe(nonCanonical.score);
    expect(canonical.reasons).toEqual(nonCanonical.reasons);
    expect(canonical.reasons.join(" ")).not.toMatch(/reliable after-work|safer pick|bigger group|capacity/i);
  });
});
