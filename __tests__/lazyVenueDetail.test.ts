import { describe, expect, it } from "vitest";

import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import type { Venue } from "@/lib/venues";

function venue(id: string, name = id): Venue {
  return {
    id,
    name,
    address: "",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.5,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
  };
}

describe("mergeLazyDetailPins", () => {
  it("keeps the loaded detail's own price read day", () => {
    const slim = { ...venue("venue-a", "Slim A"), cheapestPint: "Guinness", measure: "pint",
      priceSource: "Guinndex", priceObservedAt: "2026-11-07" };
    const detail = { ...venue("venue-a", "Detail A"), cheapestPrice: 6, cheapestPint: "Lager",
      priceSource: "Pub menu", priceObservedAt: "2026-11-08" };

    expect(mergeLazyDetailPins([slim], new Map([[detail.id, detail]]))).toEqual([detail]);
  });

  it("carries the complete pin evidence over an unpriced detail record", () => {
    const slim = { ...venue("venue-a", "Slim A"), cheapestPint: "Guinness", measure: "pint",
      priceSource: "Guinndex", priceObservedAt: "2026-11-07" };
    const detail = { ...venue("venue-a", "Detail A"), cheapestPrice: null, measure: "half",
      priceSource: "Old menu", priceObservedAt: "2025-01-01" };

    expect(mergeLazyDetailPins([slim], new Map([[detail.id, detail]]))[0]).toMatchObject({
      name: "Detail A", cheapestPrice: 5.5, cheapestPint: "Guinness", measure: "pint",
      priceSource: "Guinndex", priceObservedAt: "2026-11-07",
    });
  });

  it("keeps Arnos Arms' read day when detail supplies its omitted pint name", () => {
    const slim = { ...venue("venue-xjf3n0", "Arnos Arms"), priceSource: "Pint Prices",
      priceObservedAt: "2026-11-09" };
    const detail = { ...venue(slim.id, "Arnos Arms"), cheapestPint: "AMSTEL" };

    const [merged] = mergeLazyDetailPins([slim], new Map([[detail.id, detail]]));
    expect(merged).toEqual({ ...detail, priceObservedAt: "2026-11-09" });
  });


  it("replaces slim pins with loaded venue detail", () => {
    const slim = venue("venue-a", "Slim A");
    const detail = venue("venue-a", "Detail A");

    expect(mergeLazyDetailPins([slim], new Map([["venue-a", detail]]))).toEqual([detail]);
  });

  it("keeps the pin's fare zone when the detail record carries none", () => {
    const slim: Venue = { ...venue("venue-a", "Slim A"), zone: 4 };
    const detail = venue("venue-a", "Detail A");

    expect(mergeLazyDetailPins([slim], new Map([["venue-a", detail]]))).toEqual([
      { ...detail, zone: 4 },
    ]);
  });

  it("keeps selected deep-link detail resolvable when the slim index cache is stale", () => {
    const slim = venue("venue-a", "Slim A");
    const detail = venue("venue-b", "Detail B");

    expect(mergeLazyDetailPins([slim], new Map([["venue-b", detail]])).map((item) => item.id))
      .toEqual(["venue-a", "venue-b"]);
  });

  it("never pins a retired pub a shared crawl link hydrated", () => {
    const slim = venue("venue-a", "Slim A");
    const retired: Venue = { ...venue("venue-bhm-17j3xm7", "The Duck"), retired: true };

    expect(
      mergeLazyDetailPins([slim], new Map([["venue-bhm-17j3xm7", retired]])).map((item) => item.id),
    ).toEqual(["venue-a"]);
  });
});
