import { describe, expect, it } from "vitest";

import {
  planProvisionalBaseVenueRead,
  readCategoryPriceIndexLoad,
  readProvisionalVenueIdsLoad,
  readVenuePriceLoad,
  rollbackOptimisticPrice,
} from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";

const storedBeer: CommunityPrice = {
  venueId: "venue-uk-n123",
  drinkCategory: "beer",
  priceGbp: 4.6,
  submittedAt: 2_000,
  source: "community",
  corroborations: 1,
};

const optimisticBeer: CommunityPrice = {
  venueId: "venue-uk-n123",
  drinkCategory: "beer",
  priceGbp: 5.2,
  submittedAt: 3_000,
  source: "community",
  corroborations: 1,
};

describe("community price client state", () => {
  it("reads only newly visible stable base ids", () => {
    expect(
      planProvisionalBaseVenueRead(
        [
          "venue-uk-w2",
          "venue-curated",
          "venue-uk-n1",
          "venue-uk-w2",
          "venue-uk-n3",
        ],
        new Set(["venue-uk-n1", "venue-uk-n3"]),
      ),
    ).toEqual({
      visible: ["venue-uk-n1", "venue-uk-n3", "venue-uk-w2"],
      unread: ["venue-uk-w2"],
    });
  });

  it("accepts only stable base ids from a provisional viewport response", () => {
    expect(
      readProvisionalVenueIdsLoad({
        venueIds: [
          "venue-uk-n123",
          "venue-curated",
          "",
          "venue-uk-n456",
          "venue-uk-n999",
        ],
      },
        new Set(["venue-uk-n123", "venue-uk-n456"]),
      ),
    ).toEqual({
      status: "ready",
      venueIds: ["venue-uk-n123", "venue-uk-n456"],
    });
    expect(
      readProvisionalVenueIdsLoad(
        {
          venueIds: [],
          degraded: true,
        },
        new Set(),
      ),
    ).toEqual({ status: "degraded", venueIds: [] });
    expect(readProvisionalVenueIdsLoad({ venueIds: "bad" }, new Set())).toEqual({
      status: "invalid",
      venueIds: [],
    });
  });

  it("distinguishes an honest empty lens index from a degraded one", () => {
    expect(readCategoryPriceIndexLoad({ prices: [], truncated: false })).toEqual({
      status: "ready",
      prices: [],
      truncated: false,
    });
    expect(
      readCategoryPriceIndexLoad({
        prices: [],
        truncated: false,
        degraded: true,
      }),
    ).toEqual({
      status: "degraded",
      prices: [],
      truncated: false,
    });
    expect(readCategoryPriceIndexLoad({ prices: "bad" })).toEqual({
      status: "invalid",
      prices: [],
      truncated: false,
    });
  });
  it("keeps a degraded empty read unknown instead of confirming no price", () => {
    expect(readVenuePriceLoad({ prices: [], degraded: true })).toEqual({
      status: "degraded",
      prices: [],
    });
    expect(readVenuePriceLoad({ prices: [] })).toEqual({
      status: "ready",
      prices: [],
    });
  });

  it("rolls back only its optimistic row after a concurrent read", () => {
    const storedWine: CommunityPrice = {
      venueId: "venue-uk-n123",
      drinkCategory: "wine",
      priceGbp: 8.5,
      submittedAt: 2_500,
      source: "community",
      corroborations: 1,
    };

    expect(
      rollbackOptimisticPrice(
        [optimisticBeer, storedWine],
        optimisticBeer,
        [storedBeer, storedWine],
        true,
      ),
    ).toEqual([storedWine, storedBeer]);
  });
});
