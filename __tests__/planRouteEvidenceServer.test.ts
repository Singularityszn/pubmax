import { describe, expect, it } from "vitest";

import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import {
  planAccessEvidenceForVenue,
  planOpeningSchedulesForVenues,
  planPriceEvidenceForVenues,
} from "@/lib/planRouteEvidence.server";

const ICE_WHARF = {
  id: "venue-17u2i1w",
  name: "The Ice Wharf - JD Wetherspoon",
  area: "Camden",
  lat: 51.5404,
  lng: -0.145649,
};

describe("canonical Plan evidence adapters", () => {
  it("joins venue ids to attributable pence and confidence state", async () => {
    // The clock is DERIVED from the bundle's own collection stamp, 17 days
    // after it, so this keeps testing the "aging" band whenever the prices were
    // re-collected. A fixed instant froze to the first extract's day and read
    // the bundle as evidence from the future the moment it was refreshed.
    const seventeenDays = 17 * 24 * 60 * 60 * 1000;
    const evidence = await planPriceEvidenceForVenues(
      [ICE_WHARF],
      PINT_DATASET_OBSERVED_AT.getTime() + seventeenDays,
    );
    expect(evidence.get(ICE_WHARF.id)).toMatchObject({
      pence: 366,
      confidenceState: "aging",
      source: {
        // The publisher's name alone. Raw dataset ids read as plumbing beside
        // a price, so they stay off the label (report D12).
        label: "Pint Prices",
        url: expect.stringMatching(/^https:\/\//),
        observedAt: expect.any(String),
      },
    });
  });

  it("uses the matched opening row's observation and keeps it a weekly schedule", async () => {
    const schedules = await planOpeningSchedulesForVenues([ICE_WHARF]);
    expect(schedules.get(ICE_WHARF.id)).toMatchObject({
      venueListedOpen: true,
      ranges: expect.arrayContaining([expect.objectContaining({ weekday: expect.any(String) })]),
      source: { observedAt: "2026-07-11T11:51:37.000Z" },
    });
  });

  it("does not project seated service into reliable-seating evidence", () => {
    expect(planAccessEvidenceForVenue(ICE_WHARF)).toMatchObject({ stepFree: { confirmed: true } });
    expect(planAccessEvidenceForVenue(ICE_WHARF)).not.toHaveProperty("seating");
    expect(planAccessEvidenceForVenue(ICE_WHARF)).not.toHaveProperty("lowNoise");
  });
});
