import { describe, expect, it } from "vitest";

import {
  DRINK_LANDING_PUBLICATION_FLOOR,
  DRINK_LANDING_ROW_LIMIT,
  buildDrinkLandingModel,
} from "@/lib/drinkLanding";
import type { Venue } from "@/lib/venues";

function venue({
  id,
  name = id,
  price = 4,
  exactPrice = price,
  sourceUrl = "https://www.pint-prices.com/pub/test",
  kind = "pub",
}: {
  id: string;
  name?: string;
  price?: number | null;
  exactPrice?: number | null;
  sourceUrl?: string;
  kind?: Venue["kind"];
}): Venue {
  return {
    id,
    name,
    kind,
    primaryBorough: "Camden",
    cheapestPrice: price,
    prices: exactPrice === null
      ? []
      : [{
          app_price_id: `${id}-price`,
          pint_name: "House lager",
          price_gbp: exactPrice,
          pub_url: sourceUrl,
        }],
  } as unknown as Venue;
}

describe("governed drink landing model", () => {
  it("publishes only registered categories", () => {
    expect(buildDrinkLandingModel("wine", [])).toBeNull();
  });

  it("refuses publication below the exact Pint Price evidence floor", () => {
    const venues = Array.from(
      { length: DRINK_LANDING_PUBLICATION_FLOOR - 1 },
      (_, index) => venue({ id: `venue-${index}` }),
    );

    expect(buildDrinkLandingModel("beer", venues)).toBeNull();
  });

  it("excludes non-pubs, missing prices, and mismatched price rows", () => {
    const model = buildDrinkLandingModel(
      "beer",
      [
        venue({ id: "venue-valid", price: 4 }),
        venue({ id: "venue-bar", kind: "bar", price: 3 }),
        venue({ id: "venue-missing", price: null, exactPrice: null }),
        venue({ id: "venue-mismatch", price: 2.5, exactPrice: 5 }),
      ],
      { publicationFloor: 1 },
    );

    expect(model?.rows.map((row) => row.venueId)).toEqual(["venue-valid"]);
    expect(model?.totalPricedVenues).toBe(1);
  });

  it("sorts by price, then Venue name, then stable Venue ID", () => {
    const model = buildDrinkLandingModel(
      "beer",
      [
        venue({ id: "venue-z", name: "Beta", price: 3 }),
        venue({ id: "venue-b", name: "Alpha", price: 3 }),
        venue({ id: "venue-a", name: "Alpha", price: 3 }),
        venue({ id: "venue-cheap", name: "Gamma", price: 2 }),
      ],
      { publicationFloor: 1 },
    );

    expect(model?.rows.map((row) => row.venueId)).toEqual([
      "venue-cheap",
      "venue-a",
      "venue-b",
      "venue-z",
    ]);
  });

  it("takes publisher only from the exact Pint Price row", () => {
    const input = venue({ id: "venue-source", price: 4, sourceUrl: "" });
    input.prices = [
      {
        ...input.prices[0],
        app_price_id: "wrong-price",
        price_gbp: 5,
        pub_url: "https://www.pint-prices.com/pub/wrong",
      },
      {
        ...input.prices[0],
        app_price_id: "exact-price",
        price_gbp: 4,
        pub_url: "https://example.org/prices",
      },
    ];

    const model = buildDrinkLandingModel("beer", [input], { publicationFloor: 1 });

    expect(model?.rows[0].publisher).toEqual({
      label: "example.org",
      url: "https://example.org/prices",
    });
  });

  it("keeps missing publisher explicit and caps the ranked result", () => {
    const venues = Array.from(
      { length: DRINK_LANDING_ROW_LIMIT + 3 },
      (_, index) => venue({ id: `venue-${index}`, price: 2 + index / 100, sourceUrl: "" }),
    );

    const model = buildDrinkLandingModel("beer", venues, { publicationFloor: 1 });

    expect(model?.rows).toHaveLength(DRINK_LANDING_ROW_LIMIT);
    expect(model?.rows[0].publisher).toBeNull();
    expect(model?.totalPricedVenues).toBe(DRINK_LANDING_ROW_LIMIT + 3);
  });
});
