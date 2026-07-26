import { describe, expect, it } from "vitest";

import { buildUkBasePromotionPlan } from "../scripts/lib/ukBasePromotionAliases.mjs";

describe("buildUkBasePromotionPlan", () => {
  it("aliases promoted base ids to current curated venue ids", () => {
    const plan = buildUkBasePromotionPlan(
      [
        {
          osmId: "node/123",
          name: "Matched Arms",
          lat: 53.8,
          lng: -1.55,
          curatedRef: { source: "city:test", id: "node/123" },
        },
      ],
      new Map([
        [
          "city:test",
          [
            {
              id: "venue-tst-abc",
              name: "Matched Arms",
              lat: 53.80001,
              lng: -1.55001,
            },
          ],
        ],
      ]),
    );

    expect(plan.aliases).toEqual({ "venue-uk-n123": "venue-tst-abc" });
    expect(plan.promotedOsmIds).toEqual(new Set(["node/123"]));
  });

  it("keeps a stale curated annotation in the base pack when no current venue owns it", () => {
    const plan = buildUkBasePromotionPlan(
      [
        {
          osmId: "way/456",
          name: "Missing Arms",
          lat: 54,
          lng: -2,
          curatedRef: { source: "city:test", id: "way/456" },
        },
      ],
      new Map([["city:test", []]]),
    );

    expect(plan.aliases).toEqual({});
    expect(plan.promotedOsmIds.size).toBe(0);
  });
});
